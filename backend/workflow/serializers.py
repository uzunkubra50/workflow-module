from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    WorkflowAction,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStep,
    WorkflowTransition,
)
from .services import can_user_perform, get_available_transitions


# 2.3 İşlem Geçmişi ekranı — audit trail satırları. Salt okuma (geçmiş değiştirilmez).
class WorkflowActionSerializer(serializers.ModelSerializer):
    # İlişkili nesnelerin id'si yerine okunabilir ad/kullanıcı adı göster.
    # from_step / to_step nullable olabilir (SET_NULL); DRF null zincirde None döndürür.
    from_step = serializers.CharField(source='from_step.name', read_only=True)
    to_step = serializers.CharField(source='to_step.name', read_only=True)
    performed_by = serializers.CharField(source='performed_by.username', read_only=True)

    class Meta:
        model = WorkflowAction
        fields = ['id', 'from_step', 'to_step', 'performed_by', 'note', 'created_at']
        # Tüm alanlar salt okuma; bu serializer yalnızca geçmişi göstermek için.
        read_only_fields = ['id', 'note', 'created_at']


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
    # Bu instance'ın şu anki adımından yapılabilecek izinli geçişler (Karar 7, servisten).
    # Salt okuma; kullanıcı bunlardan birini seçip ayrı aksiyon endpoint'ine gönderecek.
    available_transitions = serializers.SerializerMethodField()
    # Frontend'de süreç ilerleme çubuğu (Steps) için: sürecin TÜM adımları, sırayla.
    definition_steps = serializers.SerializerMethodField()
    # Faz 2, rol/yetki kısıtı: bu isteği yapan kullanıcı şu an aksiyon alabilir mi?
    can_perform_action = serializers.SerializerMethodField()
    # Mevcut adımın sorumlu grubu (varsa adı, yoksa None) — bilgi amaçlı gösterim.
    responsible_group = serializers.SerializerMethodField()

    class Meta(WorkflowInstanceListSerializer.Meta):
        fields = WorkflowInstanceListSerializer.Meta.fields + [
            'assigned_to',
            'available_transitions',
            'definition_steps',
            'can_perform_action',
            'responsible_group',
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


# 3.1 Sürece bağlama / yeni iş başlatma — YAZMA amaçlı (create body'sini kabul eder).
# Kullanıcı yalnızca definition + subject (+ opsiyonel document_ref/assigned_to) gönderir.
# current_step ve status kullanıcıdan ALINMAZ; backend belirler (Yol C: başlangıç adımı otomatik).
class WorkflowInstanceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowInstance
        fields = [
            'id',
            'definition',
            'subject',
            'document_ref',
            'assigned_to',
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
