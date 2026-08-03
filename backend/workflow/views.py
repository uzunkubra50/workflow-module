from collections import defaultdict

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import ProtectedError, Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import services
from .models import (
    Delegation,
    GroupDefinitionPermission,
    Notification,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStep,
    WorkflowTransition,
)
from .serializers import (
    DelegationSerializer,
    GroupSerializer,
    NotificationSerializer,
    UserBasicSerializer,
    UserCreateSerializer,
    UserWithGroupsSerializer,
    WorkflowActionSerializer,
    WorkflowDefinitionSerializer,
    WorkflowDefinitionWriteSerializer,
    WorkflowInstanceCreateSerializer,
    WorkflowInstanceDetailSerializer,
    WorkflowInstanceListSerializer,
    WorkflowStepSerializer,
    WorkflowStepWriteSerializer,
    WorkflowTransitionWriteSerializer,
)


class WorkflowInstanceViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """WorkflowInstance için list / retrieve / create + özel aksiyon endpoint'i.

    Bilinçli olarak ModelViewSet DEĞİL: update (PUT/PATCH) ve destroy endpoint'leri
    hiç tanımlanmaz. İş akışı bütünlüğü (Karar 7/8) gereği bir instance yalnızca tanımlı
    geçişlerle (perform-action) ilerler; keyfi güncelleme/silme yoktur.
    """

    queryset = WorkflowInstance.objects.all()

    def get_queryset(self):
        """Ekran 2.1 "İş Akışlarım": kullanıcının ilgili olduğu işler.

        İki ölçüt VEYA ile birleşir:
          1. Şu an bende olan: mevcut adımın sorumlu grubu, kullanıcının gruplarından
             biri. "Yapılacak işlerim" kısmı.
          2. Benim işlem yaptığım: geçmişte bu işte bir aksiyon almışım.

        İkinci ölçüt olmadan ekran tutarsız kalıyordu: iş bitince "Sonuçlandı"
        adımına geçiyor, o adımın sorumlu grubu olmadığı için hiç kimsenin
        listesinde kalmıyordu. Sonuç olarak "Tamamlanan"/"Reddedilen" filtreleri ve
        istatistik kartları normal kullanıcı için kalıcı olarak 0 gösteriyordu —
        kararı veren kişi bile kendi onayladığı işi göremiyordu.

        Filtre YALNIZCA listeye uygulanır. Detay ucu bilinçli olarak kısıtlanmaz:
        2.2 ekranı, kullanıcı o adımda yetkili olmasa bile işi görüp "bu adımda
        işlem yapma yetkiniz yok, sorumlu grup: X" uyarısını göstermek üzere
        tasarlandı (bkz. serializer'daki can_perform_action). Detayı da filtrelersek
        o uyarı erişilemez hale gelir, kullanıcı 404 alır. Aksiyon alma yetkisi
        ayrıca ve her durumda serviste doğrulanıyor (can_user_perform).

        Yönetici (superuser) istisnadır: denetim ve acil müdahale için hepsini görür.

        VEKALET DÜZELTMESİ: "şu an bende olan" ölçütü artık yalnızca kullanıcının
        kendi gruplarına değil, get_effective_users(user) (kendisi + vekaleten temsil
        ettiği kişiler) üzerinden birleşik gruplara bakıyor. Önceden burada doğrudan
        user.groups.all() kullanılıyordu — can_user_perform vekaleti doğru uyguladığı
        için detay ekranında (2.2) butonlar doğru çıkıyordu, ama bu liste filtresi
        vekaleti hiç bilmediği için vekaleten sorumlu olunan iş listede hiç
        görünmüyordu: kullanıcı butonu görebilecek olduğu işe erişemiyordu, çünkü
        işi listede hiç bulamıyordu.

        AÇIK KALAN NOKTA: bir işi açıp hiç işlem yapmayan kullanıcı onu göremez —
        ne created_by alanı var, ne assigned_to dolduruluyor. Bu bir kapsam sorusu,
        cevap gelince ele alınacak.
        """
        queryset = super().get_queryset()

        # list dışındaki eylemler (retrieve, perform-action, actions) filtrelenmez.
        if self.action != 'list':
            return queryset

        user = self.request.user
        if user.is_superuser:
            return queryset

        # can_user_perform ile AYNI vekalet mantığı: kendisi + vekaleten temsil
        # ettiği kişilerin gruplarının birleşimi.
        effective_users = services.get_effective_users(user)
        responsible_groups = Group.objects.filter(user__in=effective_users).distinct()

        # distinct(): actions üzerinden JOIN, çok aksiyonlu işi mükerrer döndürür.
        return queryset.filter(
            Q(current_step__responsible_group__in=responsible_groups)
            | Q(actions__performed_by=user)
        ).distinct()

    def get_serializer_class(self):
        # Liste hafif (ad gösterimi), create yazma amaçlı (FK'ler yazılabilir),
        # retrieve/perform-action ağır detay serializer'ı kullanır.
        if self.action == 'list':
            return WorkflowInstanceListSerializer
        if self.action == 'create':
            return WorkflowInstanceCreateSerializer
        return WorkflowInstanceDetailSerializer

    def perform_create(self, serializer):
        """POST /api/instances/ (3.1 Yeni İş Başlat): oluşturma yetkisini kontrol eder
        ve kaydı oluşturan kullanıcıyı created_by'a otomatik yazar.

        Mentör geri bildirimi: herkes iş başlatamamalı, yalnızca yetkili kullanıcılar
        (amir/memur/yönetici) başlatabilmeli. Bunun için Django'nun HAZIR izin sistemi
        kullanılıyor — 'workflow.add_workflowinstance' migration sırasında OTOMATİK
        üretilir, ayrı bir izin modeli yazılmadı.

        Bu kısıtlama SADECE create içindir: list/retrieve/perform-action/actions
        etkilenmez, onlar kendi mevcut kurallarıyla (liste filtresi, can_user_perform)
        çalışmaya devam eder.

        Faz 2, grup bazlı/süreç özelinde yetki: eski genel kontrolün (user_can_create_
        instance) YERİNE, artık services.get_allowed_definitions(user) kontrol edilir —
        bu fonksiyon zaten kısıtlanmamış süreçler için genel izne düşüyor (eski davranış
        korunur), kısıtlanmış süreçlerde ise yalnızca izinli gruplara izin veriyor.
        Superuser her zaman yetkilidir (get_allowed_definitions içinde ayrıca ele alınır).
        """
        user = self.request.user
        definition = serializer.validated_data.get('definition')
        if not services.get_allowed_definitions(user).filter(pk=definition.pk).exists():
            raise PermissionDenied('Bu süreci başlatma yetkiniz yok.')
        serializer.save(created_by=user)

    @action(detail=False, methods=['get'], url_path='can-create')
    def can_create(self, request):
        """GET /api/instances/can-create/ — frontend'in "Yeni İş Başlat" butonunu
        gösterip gizlemesi için. perform_create'teki yetki kuralıyla aynı mantık;
        burada yalnızca sonucu döndürür, hiçbir kayıt oluşturmaz/değiştirmez."""
        return Response({'can_create': services.user_can_create_instance(request.user)})

    @action(detail=True, methods=['post'], url_path='perform-action')
    def perform_action(self, request, pk=None):
        """POST /api/instances/{id}/perform-action/ — instance'ı seçilen geçişle ilerletir.

        İş mantığı servistedir (Karar 7). View yalnızca: isteği çözer, servisi çağırır,
        sonucu/hatayı HTTP yanıtına çevirir.

        Body: {"transition_id": <id>, "note": "<opsiyonel>"}
        """
        instance = self.get_object()

        transition_id = request.data.get('transition_id')
        if not transition_id:
            return Response(
                {'error': 'transition_id zorunludur.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Geçersiz/olmayan transition_id -> 404 (DRF get_object_or_404 bad pk'yi de yakalar).
        transition = get_object_or_404(WorkflowTransition, pk=transition_id)

        try:
            services.perform_transition(
                instance,
                transition,
                request.user,
                note=request.data.get('note', ''),
            )
        except PermissionDenied as exc:
            # Kullanıcı bu adımda yetkili değil (Faz 2, responsible_group kısıtı) -> 403.
            return Response(
                {'error': str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except ValidationError as exc:
            # İzinsiz/geçersiz geçiş: servis ValidationError fırlatır -> 400.
            return Response(
                {'error': exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Güncel durumu + yeni available_transitions'ı döndür ki istemci hemen görsün.
        instance.refresh_from_db()
        serializer = WorkflowInstanceDetailSerializer(
            instance, context=self.get_serializer_context()
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        """POST /api/instances/{id}/cancel/ — işi iptal eder.

        perform-action'dan BAĞIMSIZ ayrı bir akış (bkz. services.cancel_instance):
        tanımlı bir geçiş üzerinden ilerlemez, current_step DEĞİŞMEZ. İş mantığı
        serviste; view yalnızca isteği çözer, servisi çağırır, sonucu/hatayı HTTP
        yanıtına çevirir (perform_action'daki desenle aynı).

        Body: {"reason": "<zorunlu>"}
        """
        instance = self.get_object()
        reason = request.data.get('reason', '')

        try:
            services.cancel_instance(instance, request.user, reason)
        except PermissionDenied as exc:
            # Kullanıcı işi başlatan kişi/yönetici değil -> 403.
            return Response(
                {'error': str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )
        except ValidationError as exc:
            # İş zaten aktif değil ya da gerekçe boş -> 400.
            return Response(
                {'error': exc.messages},
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance.refresh_from_db()
        serializer = WorkflowInstanceDetailSerializer(
            instance, context=self.get_serializer_context()
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='actions')
    def actions(self, request, pk=None):
        """Bu instance'ın işlem geçmişini (audit trail) kronolojik döndürür — 2.3 ekranı için."""
        instance = self.get_object()
        # related_name='actions'; en eski -> en yeni sırayla.
        actions = instance.actions.all().order_by('created_at')
        serializer = WorkflowActionSerializer(actions, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkflowDefinitionViewSet(viewsets.ModelViewSet):
    """Süreç tanımları.

    list/retrieve: TÜM giriş yapmış kullanıcılar (frontend'in "Yeni İş" formundaki
    dropdown'ı, Kanban süreç seçimi vb. — bkz. get_queryset, normal kullanıcıya
    yalnızca aktif süreçler döner).

    create/update/partial_update/destroy: Süreç Tasarlama ekranı — SADECE staff/
    superuser (get_permissions, _require_staff).
    """

    # Şema/router için varsayılan; asıl davranış get_queryset'te (staff/normal ayrımı).
    queryset = WorkflowDefinition.objects.filter(is_active=True)
    serializer_class = WorkflowDefinitionSerializer

    def get_permissions(self):
        """list/retrieve: herkese açık (IsAuthenticated yeterli). create/update/
        partial_update/destroy: SADECE staff/superuser — _require_staff PermissionDenied
        fırlatır, DRF'nin dispatch() döngüsü bunu otomatik 403'e çevirir (perform_create
        gibi imperatif çağrılardaki AYNI mekanizma, burada get_permissions üzerinden)."""
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            _require_staff(self.request)
        return [IsAuthenticated()]

    def get_queryset(self):
        """staff/superuser: TÜM süreçler (aktif + pasif/taslak) — Süreç Tasarlama
        ekranında oluşturulan bir taslağı (is_active=False) ya da sonradan pasife
        alınan bir süreci staff'ın kendisi bile göremez/düzenleyemez hale gelmesin diye
        (UserViewSet.is_active'de yaşanan aynı hatanın burada tekrarlanmaması için).
        Normal kullanıcı: eski davranış korunur, yalnızca aktif süreçler."""
        if self.request.user.is_staff or self.request.user.is_superuser:
            return WorkflowDefinition.objects.all()
        return WorkflowDefinition.objects.filter(is_active=True)

    def get_serializer_class(self):
        # Yazma action'larında ham FK id'leri kabul eden serializer; okumada mevcut
        # salt-okuma (unit adı vb. çevrilmiş) serializer.
        if self.action in ('create', 'update', 'partial_update'):
            return WorkflowDefinitionWriteSerializer
        return WorkflowDefinitionSerializer

    @action(detail=True, methods=['get'], url_path='validate')
    def validate_definition(self, request, pk=None):
        """GET /api/definitions/{id}/validate/ — bu sürecin "yayına hazır" olup
        olmadığını kontrol eder (Süreç Tasarlama ekranı için bir gösterge). Bu bir
        ZORUNLULUK DEĞİL — kaydetmeyi/güncellemeyi engellemez, kullanıcı adım adım
        ekliyor olabilir, ara halde eksik olması normaldir.

        Kontroller:
          - En az bir is_start=True adım var mı?
          - En az bir is_end=True adım var mı?
          - is_end=False olan HER adımın en az bir çıkışı (outgoing_transitions) var
            mı? (yoksa o adıma gelen bir iş asla ilerleyemez — "çıkmaz sokak")

        Döndürür:
            {"valid": bool, "errors": [str, ...]}
        """
        definition = self.get_object()
        steps = WorkflowStep.objects.filter(definition=definition)
        errors = []

        if not steps.filter(is_start=True).exists():
            errors.append('Başlangıç adımı yok.')

        if not steps.filter(is_end=True).exists():
            errors.append('Bitiş adımı yok.')

        # outgoing_transitions__isnull=True: reverse FK üzerinden "hiç ilişkili
        # WorkflowTransition'ı olmayan adımlar" için Django'nun standart deyimi.
        steps_without_exit = steps.filter(
            is_end=False, outgoing_transitions__isnull=True
        ).values_list('name', flat=True)
        for step_name in steps_without_exit:
            errors.append(f'Şu adımdan hiç çıkış yok: {step_name}')

        return Response({'valid': len(errors) == 0, 'errors': errors})

    def destroy(self, request, *args, **kwargs):
        """WorkflowInstance.definition da (current_step gibi) on_delete=PROTECT —
        bu ViewSet ReadOnly'den tam CRUD'a çıkarılınca destroy fiilen açıldığı için,
        bağlı işleri olan bir süreç silinmeye çalışılırsa ham 500 yerine anlaşılır bir
        400 dönsün diye WorkflowStepAdminViewSet'teki AYNI savunmacı desen uygulanıyor.
        """
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'error': 'Bu süreçte kayıtlı işler olduğu için silinemez.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @action(detail=False, methods=['get'], url_path='allowed')
    def allowed(self, request):
        """GET /api/definitions/allowed/ — request.user'ın BAŞLATABİLECEĞİ süreçler
        (Faz 2, grup bazlı/süreç özelinde yetki). "Yeni İş Başlat" formundaki dropdown,
        artık tüm aktif süreçleri listeleyen düz list yerine bunu kullanmalı — asıl
        kısıtlama zaten perform_create'te de uygulanıyor, bu yalnızca frontend'in
        kullanıcıya baştan doğru seçenekleri göstermesi içindir.
        """
        qs = services.get_allowed_definitions(request.user)
        serializer = WorkflowDefinitionSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='steps')
    def steps(self, request, pk=None):
        """GET /api/definitions/{id}/steps/ — bu sürecin TÜM adımları, sırayla.

        Kanban görünümü için: her adım bir sütun olacağı için belirli bir instance'a
        bağlı olmayan (is_current içermeyen) düz bir liste döner. related_name='steps'
        (bkz. WorkflowStep.definition) üzerinden erişilir.
        """
        definition = self.get_object()
        steps = definition.steps.order_by('order')
        serializer = WorkflowStepSerializer(steps, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='analytics')
    def analytics(self, request, pk=None):
        """GET /api/definitions/{id}/analytics/ — Faz 2 panom ekranı için: her
        adımda kaç iş var, adımdan ortalama ne kadar sürede çıkılıyor.

        İş mantığı serviste (services.get_step_analytics); view yalnızca sonucu
        HTTP yanıtına çevirir.
        """
        definition = self.get_object()
        data = services.get_step_analytics(definition)
        return Response(data)

    @action(detail=True, methods=['get'], url_path='transitions')
    def transitions(self, request, pk=None):
        """GET /api/definitions/{id}/transitions/ — bu sürecin TÜM geçişleri.

        Süreç şeması görünümü (4.1) için: WorkflowTransitionSerializer to_step'i ad
        olarak verip from_step'i hiç içermediği için (2.2 detay ekranındaki dinamik
        aksiyon butonları amacıyla tasarlandı) burada işe yaramıyor; şema çiziminde
        hem from_step hem to_step'in id'si gerektiğinden basit, elle bir liste
        döndürülüyor. select_related: N+1 sorgu önlenir (from_step/to_step erişimi).
        """
        definition = self.get_object()
        qs = WorkflowTransition.objects.filter(definition=definition).select_related(
            'from_step', 'to_step'
        )
        data = [
            {
                'id': t.id,
                'action_name': t.action_name,
                'action_type': t.action_type,
                'from_step_id': t.from_step_id,
                'to_step_id': t.to_step_id,
            }
            for t in qs
        ]
        return Response(data)


class WorkflowStepAdminViewSet(viewsets.ModelViewSet):
    """Süreç Tasarlama ekranı: adım CRUD'u. SADECE staff/superuser (get_permissions,
    her action için — list/retrieve dahil, WorkflowDefinitionViewSet'ten FARKLI olarak
    burada okuma da kısıtlı, çünkü bu uç ham/tüm adımları -tüm süreçlerden- döner).

    Mevcut GET /api/definitions/{id}/steps/ (WorkflowDefinitionViewSet.steps) ile
    KARIŞTIRILMASIN: o salt okuma + herkese açık + tek bir sürece göre süzülü; bu ise
    admin/steps prefix'i altında, tam CRUD, staff-only, tüm adımlar üzerinde çalışır.
    """

    queryset = WorkflowStep.objects.all()
    serializer_class = WorkflowStepWriteSerializer

    def get_permissions(self):
        _require_staff(self.request)
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        """Bu adıma bağlı (current_step, on_delete=PROTECT — Karar 8) aktif
        WorkflowInstance'lar varsa Django ProtectedError fırlatır; ham 500 yerine
        anlaşılır bir 400 mesajına çeviriyoruz."""
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'error': 'Bu adımda aktif işler olduğu için silinemez.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


class WorkflowTransitionAdminViewSet(viewsets.ModelViewSet):
    """Süreç Tasarlama ekranı: geçiş CRUD'u. SADECE staff/superuser.

    Mevcut GET /api/definitions/{id}/transitions/ (WorkflowDefinitionViewSet.transitions,
    süreç şeması görünümü için) ile KARIŞTIRILMASIN: bu ayrı, admin/transitions
    prefix'i altında, tam CRUD.
    """

    queryset = WorkflowTransition.objects.all()
    serializer_class = WorkflowTransitionWriteSerializer

    def get_permissions(self):
        _require_staff(self.request)
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        """WorkflowAction, transition'dan action_type/action_name'i KOPYALAR (FK
        tutmaz) — geçmiş kayıtlar bir transition silindiğinde bozulmaz, bu yüzden
        özel bir DB koruması yok. Yine de diğer admin ViewSet'le tutarlı olsun diye
        aynı savunmacı desen uygulanıyor."""
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'error': 'Bu geçiş silinemedi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DelegationViewSet(viewsets.ModelViewSet):
    """Vekalet yönetimi: kullanıcı kendi verdiği vekaletleri listeler, oluşturur, siler.

    - get_queryset: yalnızca request.user'ın delegator olduğu kayıtlar.
    - perform_create: delegator otomatik request.user olarak atanır.
    - İzin: IsAuthenticated (giriş yapan herkes kendi vekaletini yönetebilir).
    """

    serializer_class = DelegationSerializer

    def get_queryset(self):
        """Kullanıcı yalnızca kendi verdiği vekaletleri görür."""
        return Delegation.objects.filter(delegator=self.request.user)

    def perform_create(self, serializer):
        """Vekalet oluştururken delegator otomatik request.user olur; vekile de
        bildirim gönderilir (instance=None, bir işle ilgili değil)."""
        delegation = serializer.save(delegator=self.request.user)
        services.notify(
            delegation.delegate,
            f"{delegation.delegator} size {delegation.start_date} - "
            f"{delegation.end_date} tarihleri arası vekalet verdi.",
            instance=None,
        )

    @action(detail=False, methods=['get'], url_path='received')
    def received(self, request):
        """GET /api/delegations/received/ — request.user'ın VEKİLİ OLDUĞU (kendisine
        verilen) vekaletler. Mevcut list/create/destroy'a dokunmaz, sadece ek bir
        salt-okuma görünümü sağlar (frontend'de "Vekili Olduğum Kişiler" bölümü)."""
        delegations = Delegation.objects.filter(delegate=request.user)
        serializer = self.get_serializer(delegations, many=True)
        return Response(serializer.data)


class NotificationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Bell ikonu bildirimleri — salt okuma + iki özel aksiyon.

    ModelViewSet DEĞİL: bildirim create/update/destroy dışarıdan yapılmaz,
    yalnızca services.notify() ile sistem içinden oluşturulur.
    """

    serializer_class = NotificationSerializer

    def get_queryset(self):
        """SADECE request.user'ın recipient olduğu bildirimler (Meta.ordering
        zaten '-created_at', en yeni önce)."""
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        """GET /api/notifications/unread-count/ — bell ikonundaki sayaç için."""
        count = self.get_queryset().filter(is_read=False).count()
        return Response({'count': count})

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        """POST /api/notifications/{id}/mark-read/ — tek bildirimi okundu yapar."""
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=['is_read'])
        serializer = self.get_serializer(notification)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        """POST /api/notifications/mark-all-read/ — tüm okunmamışları okundu yapar."""
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Kullanıcı listesi + Rol/Yetki Yönetimi ekranı ---

User = get_user_model()


def _require_staff(request):
    """Staff/superuser değilse PermissionDenied fırlatır (DRF bunu otomatik 403'e
    çevirir — perform_create'teki desenle aynı). UserViewSet ve GroupViewSet'in
    staff-only aksiyonlarında ortak kullanılır (tek yerde toplanmış yetki kontrolü)."""
    if not (request.user.is_staff or request.user.is_superuser):
        raise PermissionDenied('Bu işlem için yetkiniz yok.')


class UserViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """GET /api/users/ — aktif kullanıcı listesi + Rol/Yetki Yönetimi ekranı için
    grup/izin/hesap durumu güncelleme aksiyonları. POST /api/users/ — yeni kullanıcı
    hesabı açar (Django admin'e gitmeye gerek kalmasın diye eklendi).

    GET /api/users/ İKİ FARKLI görünüm döner (get_serializer_class):
      - Normal kullanıcı: sade id+username, YALNIZCA aktif hesaplar (mevcut/eski
        davranış, vekil seçim dropdown'ı için yeterli — pasif birine vekalet
        verilemez).
      - staff/superuser: id+username'e ek olarak gruplar, iş başlatma izni, hesap
        durumu, superuser durumu (UserWithGroupsSerializer) — Rol/Yetki Yönetimi
        ekranı. Pasif kullanıcılar da DAHİL: aksi halde bir hesap pasife alınınca
        staff onu ne listede görebilir ne de tekrar aktif yapabilirdi.

    POST /api/users/ ve PATCH /api/users/{id}/groups/, /permissions/, /active/
    SADECE staff/superuser kullanabilir (_require_staff, 403 fırlatır).
    """

    queryset = User.objects.all().order_by('username')

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.request.user.is_staff or self.request.user.is_superuser:
            return UserWithGroupsSerializer
        return UserBasicSerializer

    def create(self, request, *args, **kwargs):
        """POST /api/users/ — Body: {"username": "...", "password": "..."}.

        Yeni kullanıcı, gruba/izne atanmadan (staff sonradan Gruplar/İş Başlatabilir
        sütunlarından ayarlar), aktif olarak oluşturulur. Yanıt UserWithGroupsSerializer
        ile döner ki frontend tabloya doğrudan ekleyebilsin (groups: [], can_create_
        instance: false gibi diğer satırlarla aynı alan setiyle)."""
        _require_staff(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        output_serializer = UserWithGroupsSerializer(user, context=self.get_serializer_context())
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.is_staff or self.request.user.is_superuser:
            # groups için N+1 önlenir; genişletilmiş görünümde her satırda kullanılıyor.
            return queryset.prefetch_related('groups')
        # Normal kullanıcı: eski davranış korunur, yalnızca aktif hesaplar görünür.
        return queryset.filter(is_active=True)

    @action(detail=False, methods=['get'], url_path='me')
    def me(self, request):
        """GET /api/users/me/ — giriş yapmış kullanıcının is_staff/is_superuser
        durumu. Sidebar menüsünün admin-only sekmelerini (Rol Yönetimi/Süreç
        Yetkileri/Süreç Tasarla) sadece yetkili kullanıcılara göstermek için."""
        return Response(
            {
                'is_staff': request.user.is_staff,
                'is_superuser': request.user.is_superuser,
            }
        )

    @action(detail=True, methods=['patch'], url_path='groups')
    def update_groups(self, request, pk=None):
        """PATCH /api/users/{id}/groups/ — Body: {"group_ids": [1, 3]}.

        Kullanıcının gruplarını TAMAMEN gönderilen listeyle değiştirir (ekleme değil,
        yerine koyma — group_ids'de olmayan mevcut gruplardan çıkarılır).
        """
        _require_staff(request)
        user = self.get_object()

        group_ids = request.data.get('group_ids')
        if not isinstance(group_ids, list):
            return Response(
                {'error': 'group_ids bir liste olmalıdır.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        groups = Group.objects.filter(pk__in=group_ids)
        user.groups.set(groups)

        serializer = UserWithGroupsSerializer(user, context=self.get_serializer_context())
        return Response(serializer.data)

    @action(detail=True, methods=['patch'], url_path='permissions')
    def update_permissions(self, request, pk=None):
        """PATCH /api/users/{id}/permissions/ — Body: {"can_create_instance": true/false}.

        True ise 'workflow.add_workflowinstance' iznini kullanıcıya ekler, false ise
        kaldırır (perform_create/can-create'in kontrol ettiği izinle aynı).
        """
        _require_staff(request)
        user = self.get_object()

        can_create_instance = request.data.get('can_create_instance')
        if not isinstance(can_create_instance, bool):
            return Response(
                {'error': 'can_create_instance bir boolean olmalıdır.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        permission = Permission.objects.get(
            content_type__app_label='workflow', codename='add_workflowinstance'
        )
        if can_create_instance:
            user.user_permissions.add(permission)
        else:
            user.user_permissions.remove(permission)

        serializer = UserWithGroupsSerializer(user, context=self.get_serializer_context())
        return Response(serializer.data)

    @action(detail=True, methods=['patch'], url_path='active')
    def active(self, request, pk=None):
        """PATCH /api/users/{id}/active/ — Body: {"is_active": true/false}.

        Kullanıcı hesabını aktif/pasif yapar (pasif kullanıcı giriş yapamaz — Django'nun
        hazır auth akışı zaten is_active=False hesapları reddeder, ayrı bir kontrol
        yazmaya gerek yok). Superuser hesabı pasif YAPILAMAZ — sistemin son
        yöneticisinin yanlışlıkla kilitlenmesini engellemek için.
        """
        _require_staff(request)
        user = self.get_object()

        is_active = request.data.get('is_active')
        if not isinstance(is_active, bool):
            return Response(
                {'error': 'is_active bir boolean olmalıdır.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.is_superuser and not is_active:
            return Response(
                {'error': 'Yönetici hesabı pasif yapılamaz.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.is_active = is_active
        user.save(update_fields=['is_active'])

        serializer = UserWithGroupsSerializer(user, context=self.get_serializer_context())
        return Response(serializer.data)


class GroupViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """GET /api/groups/ — basit grup listesi (id+name) + Rol/Yetki Yönetimi ekranı
    için grup bazlı süreç yetkisi aksiyonları. POST/DELETE /api/groups/ — grup
    oluşturma/silme (Kullanıcı Yönetimi ekranı, Django admin'e gitmeye gerek
    kalmasın diye eklendi).

    Liste (GET) kısıtlama yok: grup adlarının görünmesi zararsız, veri değiştirmiyor.
    POST/DELETE, /definitions/ ve GET /definition_matrix/ SADECE staff/superuser
    kullanabilir.

    Silme davranışı bilerek PROTECT DEĞİL: WorkflowStep.responsible_group ve
    escalation_group SET_NULL (adım sorumlu grupsuz kalır, kısıt kalkar — bkz.
    can_user_perform: responsible_group None ise herkes yapabilir),
    GroupDefinitionPermission.group CASCADE (o grubun süreç kısıtlamaları silinir).
    Yani bir grubu silmek hiçbir kaydı kilitlemez ama adımların yetki kapısını
    açabilir — bunu frontend silme onayında kullanıcıya açıkça söylüyoruz.
    """

    queryset = Group.objects.all().order_by('name')
    serializer_class = GroupSerializer

    def get_permissions(self):
        if self.action in ('create', 'destroy'):
            _require_staff(self.request)
        return [IsAuthenticated()]

    @action(detail=True, methods=['patch'], url_path='definitions')
    def definitions(self, request, pk=None):
        """PATCH /api/groups/{id}/definitions/ — Body: {"definition_ids": [1, 2]}.

        Bu grubun hangi WorkflowDefinition'ları başlatabileceğini TAMAMEN gönderilen
        listeyle değiştirir (ekleme değil, yerine koyma — update_groups'taki desenle
        aynı mantık). definition_ids boş liste ise grup için tüm kısıtlamalar
        kaldırılır (o gruba özel bir izin kalmaz; kısıtlanmamış süreçlerde genel izin
        kuralı geçerli olmaya devam eder).
        """
        _require_staff(request)
        group = self.get_object()

        definition_ids = request.data.get('definition_ids')
        if not isinstance(definition_ids, list):
            return Response(
                {'error': 'definition_ids bir liste olmalıdır.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        GroupDefinitionPermission.objects.filter(group=group).delete()
        GroupDefinitionPermission.objects.bulk_create(
            [
                GroupDefinitionPermission(group=group, definition_id=definition_id)
                for definition_id in definition_ids
            ]
        )

        return Response({'definition_ids': definition_ids})

    @action(detail=False, methods=['get'], url_path='definition_matrix')
    def definition_matrix(self, request):
        """GET /api/groups/definition_matrix/ — Rol/Yetki Yönetimi ekranında mevcut
        grup bazlı süreç izinlerini bir arada görmek için: her grup + o grubun izinli
        olduğu definition id'leri.

        [{"group_id": 1, "group_name": "Evrak Birimi", "definition_ids": [1, 3]}, ...]
        """
        _require_staff(request)

        # Tüm izinler TEK sorguda çekilip group_id'ye göre gruplanır (N+1 önlenir).
        permissions_by_group = defaultdict(list)
        for group_id, definition_id in GroupDefinitionPermission.objects.values_list(
            'group_id', 'definition_id'
        ):
            permissions_by_group[group_id].append(definition_id)

        data = [
            {
                'group_id': group.id,
                'group_name': group.name,
                'definition_ids': permissions_by_group.get(group.id, []),
            }
            for group in Group.objects.all().order_by('name')
        ]
        return Response(data)


