from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Q
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Delegation, WorkflowDefinition, WorkflowInstance, WorkflowTransition
from .serializers import (
    DelegationSerializer,
    WorkflowActionSerializer,
    WorkflowDefinitionSerializer,
    WorkflowInstanceCreateSerializer,
    WorkflowInstanceDetailSerializer,
    WorkflowInstanceListSerializer,
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

        Superuser her zaman yetkilidir (can_user_perform'daki superuser kuralıyla
        tutarlı; ayrıca Django'nun has_perm'i de superuser için zaten True döner).
        """
        user = self.request.user
        if not (user.is_superuser or user.has_perm('workflow.add_workflowinstance')):
            raise PermissionDenied('İş başlatma yetkiniz yok.')
        serializer.save(created_by=user)

    @action(detail=False, methods=['get'], url_path='can-create')
    def can_create(self, request):
        """GET /api/instances/can-create/ — frontend'in "Yeni İş Başlat" butonunu
        gösterip gizlemesi için. perform_create'teki yetki kuralıyla aynı mantık;
        burada yalnızca sonucu döndürür, hiçbir kayıt oluşturmaz/değiştirmez."""
        user = request.user
        can_create = user.is_superuser or user.has_perm('workflow.add_workflowinstance')
        return Response({'can_create': can_create})

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

    @action(detail=True, methods=['get'], url_path='actions')
    def actions(self, request, pk=None):
        """Bu instance'ın işlem geçmişini (audit trail) kronolojik döndürür — 2.3 ekranı için."""
        instance = self.get_object()
        # related_name='actions'; en eski -> en yeni sırayla.
        actions = instance.actions.all().order_by('created_at')
        serializer = WorkflowActionSerializer(actions, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkflowDefinitionViewSet(viewsets.ReadOnlyModelViewSet):
    """Süreç tanımları — salt okuma (list + retrieve).

    Frontend'in "Yeni İş" formundaki dropdown'ı için. Yalnızca aktif süreçler döner.
    """

    queryset = WorkflowDefinition.objects.filter(is_active=True)
    serializer_class = WorkflowDefinitionSerializer


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
        """Vekalet oluştururken delegator otomatik request.user olur."""
        serializer.save(delegator=self.request.user)

    @action(detail=False, methods=['get'], url_path='received')
    def received(self, request):
        """GET /api/delegations/received/ — request.user'ın VEKİLİ OLDUĞU (kendisine
        verilen) vekaletler. Mevcut list/create/destroy'a dokunmaz, sadece ek bir
        salt-okuma görünümü sağlar (frontend'de "Vekili Olduğum Kişiler" bölümü)."""
        delegations = Delegation.objects.filter(delegate=request.user)
        serializer = self.get_serializer(delegations, many=True)
        return Response(serializer.data)


# --- Kullanıcı listesi (vekalet formundaki vekil seçimi için) ---

User = get_user_model()


class UserListView(APIView):
    """GET /api/users/ — aktif kullanıcıların id + username listesi.

    Yalnızca vekalet formundaki Select dropdown'ına veri sağlamak için.
    İzin: IsAuthenticated (varsayılan DRF ayarından devralır).
    """

    def get(self, request):
        users = User.objects.filter(is_active=True).order_by('username')
        data = [{'id': u.id, 'username': u.username} for u in users]
        return Response(data)


