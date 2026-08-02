from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import (
    Delegation,
    Notification,
    WorkflowAction,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStep,
    WorkflowTransition,
)
from .services import can_user_perform, get_available_transitions, user_can_create_instance

User = get_user_model()


# 2.3 İşlem Geçmişi ekranı — audit trail satırları. Salt okuma (geçmiş değiştirilmez).
class WorkflowActionSerializer(serializers.ModelSerializer):
    # İlişkili nesnelerin id'si yerine okunabilir ad/kullanıcı adı göster.
    # from_step nullable olabilir (SET_NULL) ama pratikte hep dolu gelir.
    from_step = serializers.CharField(source='from_step.name', read_only=True)
    # to_step ise İŞ İPTALİNDE (services.cancel_instance) BİLİNÇLİ olarak None —
    # CharField(source='to_step.name') kullanılsaydı, None FK üzerinden dotted source
    # çözümlemesi DRF'de SkipField fırlatır ve alan yanıttan TAMAMEN düşer (null DEĞİL,
    # anahtar hiç yok) — bu yüzden burada SerializerMethodField ile alanın her zaman
    # var olması (değeri None ya da adı) garanti ediliyor.
    to_step = serializers.SerializerMethodField()
    performed_by = serializers.CharField(source='performed_by.username', read_only=True)

    class Meta:
        model = WorkflowAction
        fields = [
            'id',
            'from_step',
            'to_step',
            'action_type',
            'action_name',
            'performed_by',
            'note',
            'created_at',
        ]
        # Tüm alanlar salt okuma; bu serializer yalnızca geçmişi göstermek için.
        read_only_fields = ['id', 'note', 'created_at']

    def get_to_step(self, obj):
        return obj.to_step.name if obj.to_step else None


# 2.2 Detay ekranındaki DİNAMİK aksiyon butonları — her geçiş bir butona dönüşür.
class WorkflowTransitionSerializer(serializers.ModelSerializer):
    to_step = serializers.CharField(source='to_step.name', read_only=True)

    class Meta:
        model = WorkflowTransition
        fields = ['id', 'action_name', 'action_type', 'to_step']


# 2.1 İş Akışlarım (Liste) ekranı — HAFİF: geçişleri/geçmişi içermez.
class WorkflowInstanceListSerializer(serializers.ModelSerializer):
    # id yerine okunabilir adlar.
    current_step = serializers.CharField(source='current_step.name', read_only=True)
    definition = serializers.CharField(source='definition.name', read_only=True)
    # Hem kod (active) status alanında, hem etiket (Aktif) ayrı alanda.
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = WorkflowInstance
        fields = [
            'id',
            'subject',
            'status',
            'status_display',
            'document_ref',
            'current_step',
            'definition',
            'created_at',
            # Faz 2 SLA: model property'si. Açıkça bir field tipi belirtmedik —
            # DRF ModelSerializer, model üzerindeki salt-okuma property'leri otomatik
            # olarak ReadOnlyField'a çevirir.
            'is_overdue',
        ]


# definition_steps alanının çıktı şekli. Asıl veri aşağıda elle (dict olarak) üretiliyor;
# bu sınıf OpenAPI şemasında doğru tipin görünmesi için @extend_schema_field'a veriliyor.
class DefinitionStepSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    order = serializers.IntegerField()
    is_current = serializers.BooleanField()


# 2.2 İş Akışı Detayı ekranı — AĞIR: liste alanları + atanan kişi + o an yapılabilecek geçişler.
class WorkflowInstanceDetailSerializer(WorkflowInstanceListSerializer):
    assigned_to = serializers.CharField(source='assigned_to.username', read_only=True)
    # Mentör geri bildirimi: işi kimin başlattığı, assigned_to ile aynı konvansiyonla
    # (id yerine kullanıcı adı) gösterilir. Salt okuma; created_by kullanıcıdan alınmaz,
    # create sırasında view'de (perform_create) otomatik atanır.
    created_by = serializers.CharField(source='created_by.username', read_only=True)
    # Bu instance'ın şu anki adımından yapılabilecek izinli geçişler (Karar 7, servisten).
    # Salt okuma; kullanıcı bunlardan birini seçip ayrı aksiyon endpoint'ine gönderecek.
    available_transitions = serializers.SerializerMethodField()
    # Frontend'de süreç ilerleme çubuğu (Steps) için: sürecin TÜM adımları, sırayla.
    definition_steps = serializers.SerializerMethodField()
    # Faz 2, rol/yetki kısıtı: bu isteği yapan kullanıcı şu an aksiyon alabilir mi?
    can_perform_action = serializers.SerializerMethodField()
    # Mevcut adımın sorumlu grubu (varsa adı, yoksa None) — bilgi amaçlı gösterim.
    responsible_group = serializers.SerializerMethodField()
    # İş iptali (Tarık Bey'in ② numaralı sorusu): bu isteği yapan kullanıcı işi iptal
    # edebilir mi? can_perform_action'dan BAĞIMSIZ bir kural — adım bazlı yetkiyle
    # değil, "işi başlatan kişi ya da yönetici" ile ilgili (bkz. services.cancel_instance).
    can_cancel = serializers.SerializerMethodField()

    class Meta(WorkflowInstanceListSerializer.Meta):
        fields = WorkflowInstanceListSerializer.Meta.fields + [
            'assigned_to',
            'created_by',
            'description',
            'available_transitions',
            'definition_steps',
            'can_perform_action',
            'responsible_group',
            'can_cancel',
        ]

    @extend_schema_field(WorkflowTransitionSerializer(many=True))
    def get_available_transitions(self, obj):
        transitions = get_available_transitions(obj)
        return WorkflowTransitionSerializer(transitions, many=True).data

    @extend_schema_field(DefinitionStepSerializer(many=True))
    def get_definition_steps(self, obj):
        steps = WorkflowStep.objects.filter(definition=obj.definition).order_by('order')
        return [
            {
                'id': step.id,
                'name': step.name,
                'order': step.order,
                'is_current': step.id == obj.current_step_id,
            }
            for step in steps
        ]

    @extend_schema_field(serializers.BooleanField())
    def get_can_perform_action(self, obj):
        # request context yoksa (örn. serializer başka bir yerden çağrılırsa) savunmacı: False.
        request = self.context.get('request')
        if request is None:
            return False
        return can_user_perform(request.user, obj)

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_responsible_group(self, obj):
        group = obj.current_step.responsible_group
        return group.name if group else None

    @extend_schema_field(serializers.BooleanField())
    def get_can_cancel(self, obj):
        # request context yoksa (bkz. get_can_perform_action) savunmacı: False.
        request = self.context.get('request')
        if request is None:
            return False
        user = request.user
        is_owner_or_admin = user.is_superuser or obj.created_by == user
        return is_owner_or_admin and obj.status == WorkflowInstance.Status.ACTIVE


# 3.1 Sürece bağlama / yeni iş başlatma — YAZMA amaçlı (create body'sini kabul eder).
# Kullanıcı yalnızca definition + subject (+ opsiyonel document_ref/assigned_to/description)
# gönderir. current_step, status ve created_by kullanıcıdan ALINMAZ; backend belirler
# (Yol C: başlangıç adımı otomatik, created_by: view'de perform_create ile otomatik).
class WorkflowInstanceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowInstance
        fields = [
            'id',
            'definition',
            'subject',
            'document_ref',
            'assigned_to',
            'description',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        definition = validated_data['definition']
        # Yol C: seçilen sürecin is_start=True adımını bul ve current_step olarak ata.
        start_step = WorkflowStep.objects.filter(
            definition=definition, is_start=True
        ).first()
        if start_step is None:
            raise serializers.ValidationError(
                'Bu süreç için başlangıç adımı (is_start) tanımlı değil.'
            )
        # Yeni iş her zaman aktif ve başlangıç adımında başlar.
        return WorkflowInstance.objects.create(
            current_step=start_step,
            status=WorkflowInstance.Status.ACTIVE,
            **validated_data,
        )


# --- Süreç dropdown'ı için hafif, salt okuma serializer'ı (frontend "Yeni İş" formu) ---


# GET /api/definitions/ — dropdown name gösterir, id gönderir.
class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    # unit nullable FK; id yerine okunabilir ad (unit yoksa None).
    unit = serializers.CharField(source='unit.name', read_only=True)

    class Meta:
        model = WorkflowDefinition
        fields = ['id', 'name', 'code', 'unit', 'is_active']


# GET /api/definitions/{id}/steps/ — Kanban görünümü için bir sürecin TÜM adımları,
# sırayla. DefinitionStepSerializer'dan (bkz. yukarı) farklı: burada belirli bir
# instance bağlamı yok, dolayısıyla is_current alanı da yok.
class WorkflowStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowStep
        fields = ['id', 'name', 'order']


# --- Süreç Tasarlama ekranı için YAZMA amaçlı serializer'lar (tam CRUD, staff-only) ---
# Yukarıdaki WorkflowDefinitionSerializer/WorkflowStepSerializer SALT OKUMA amaçlı
# (unit/current_step gibi alanları okunabilir isme çeviriyor); bunlar ise ham FK id'leri
# kabul eder (create/update body'si için) — DRF'nin ModelSerializer varsayılanı zaten
# FK alanlarını PrimaryKeyRelatedField'a çevirir, ayrıca bir şey yazmaya gerek yok.


class WorkflowDefinitionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowDefinition
        fields = ['id', 'name', 'code', 'unit', 'is_active']


class WorkflowStepWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowStep
        fields = [
            'id',
            'definition',
            'name',
            'order',
            'responsible_group',
            'is_start',
            'is_end',
            'max_duration_days',
            'escalation_group',
        ]


class WorkflowTransitionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowTransition
        fields = ['id', 'definition', 'from_step', 'to_step', 'action_name', 'action_type']


# --- Vekalet serializer'ı (CRUD) ---


class DelegationSerializer(serializers.ModelSerializer):
    """Vekalet kayıtları için okuma/yazma serializer'ı.

    delegator salt okuma — view'de request.user otomatik atanır.
    delegate yazılırken id (PrimaryKeyRelatedField), okurken username gösterilir.
    """

    # Okuma: kullanıcı adlarını göster.
    delegator = serializers.CharField(source='delegator.username', read_only=True)
    # Yazma: delegate id olarak gönderilir; queryset=User.objects.all() ile doğrulanır.
    delegate = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    # Okuma: delegate'in kullanıcı adı (id yanında okunabilir isim).
    delegate_username = serializers.CharField(source='delegate.username', read_only=True)

    class Meta:
        model = Delegation
        fields = [
            'id',
            'delegator',
            'delegate',
            'delegate_username',
            'start_date',
            'end_date',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'delegator', 'created_at']

    def validate(self, attrs):
        """Model.clean()'deki validasyonları serializer düzeyinde de uygula."""
        # delegate ve delegator (request.user) aynı kişi mi?
        request = self.context.get('request')
        if request and attrs.get('delegate') and attrs['delegate'] == request.user:
            raise serializers.ValidationError('Kişi kendine vekalet veremez.')
        # Tarih kontrolü.
        start_date = attrs.get('start_date')
        end_date = attrs.get('end_date')
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError('Bitiş tarihi başlangıçtan önce olamaz.')
        return attrs


# --- Bildirim serializer'ı (bell ikonu) — salt okuma ---


class NotificationSerializer(serializers.ModelSerializer):
    """Bell ikonu bildirim listesi. instance yalnızca id olarak verilir; frontend
    bununla /instances/{id} sayfasına link verebilir, ayrıca bilgi gerekmez."""

    class Meta:
        model = Notification
        fields = ['id', 'message', 'is_read', 'created_at', 'instance']
        read_only_fields = fields


# --- Rol/Yetki Yönetimi ekranı için kullanıcı/grup serializer'ları ---


# GET /api/groups/ dropdown'ı, kullanıcının gruplarını göstermek ve POST /api/groups/
# ile yeni grup oluşturmak için ortak, sade serializer.
class GroupSerializer(serializers.ModelSerializer):
    # 'name' alanı model üzerinde unique=True — DRF varsayılan UniqueValidator mesajı
    # İngilizce ("group with this name already exists"), uygulamanın geri kalanıyla
    # tutarlı olsun diye burada Türkçe mesajla override ediyoruz.
    name = serializers.CharField(
        max_length=150,
        validators=[
            UniqueValidator(
                queryset=Group.objects.all(),
                message='Bu isimde bir grup zaten var.',
            )
        ],
    )

    class Meta:
        model = Group
        fields = ['id', 'name']


# GET /api/users/ — NORMAL kullanıcı için (staff/superuser değilse). Vekil seçim
# dropdown'ı için yeterli, mevcut/eski davranışla birebir aynı: sadece id + username.
class UserBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']


# GET /api/users/ — STAFF/SUPERUSER için genişletilmiş görünüm (Rol/Yetki Yönetimi
# ekranı): id/username'e ek olarak gruplar, iş başlatma izni, superuser durumu.
# PATCH /api/users/{id}/groups/ ve /permissions/ de güncel hali bu serializer'la döner.
class UserWithGroupsSerializer(serializers.ModelSerializer):
    groups = GroupSerializer(many=True, read_only=True)
    can_create_instance = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'groups',
            'can_create_instance',
            'is_superuser',
            # Hesap aktif/pasif durumu — Rol/Yetki Yönetimi ekranında toggle edilebilir
            # (bkz. views.UserViewSet.active).
            'is_active',
        ]

    def get_can_create_instance(self, obj):
        return user_can_create_instance(obj)

