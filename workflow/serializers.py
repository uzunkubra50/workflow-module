from rest_framework import serializers

from .models import WorkflowAction, WorkflowInstance, WorkflowTransition
from .services import get_available_transitions


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


# 2.2 İş Akışı Detayı ekranı — AĞIR: liste alanları + atanan kişi + o an yapılabilecek geçişler.
class WorkflowInstanceDetailSerializer(WorkflowInstanceListSerializer):
    assigned_to = serializers.CharField(source='assigned_to.username', read_only=True)
    # Bu instance'ın şu anki adımından yapılabilecek izinli geçişler (Karar 7, servisten).
    # Salt okuma; kullanıcı bunlardan birini seçip ayrı aksiyon endpoint'ine gönderecek.
    available_transitions = serializers.SerializerMethodField()

    class Meta(WorkflowInstanceListSerializer.Meta):
        fields = WorkflowInstanceListSerializer.Meta.fields + [
            'assigned_to',
            'available_transitions',
        ]

    def get_available_transitions(self, obj):
        transitions = get_available_transitions(obj)
        return WorkflowTransitionSerializer(transitions, many=True).data


# 3.1 Sürece bağlama / yeni iş başlatma — YAZMA amaçlı (create body'sini kabul eder).
# Okuma serializer'ları FK'leri id yerine AD olarak salt okuma gösterdiği için, create'te
# definition/current_step'in yazılabilir olması gerekiyor; bu yüzden ayrı bir serializer.
class WorkflowInstanceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowInstance
        # definition & current_step -> yazılabilir PrimaryKeyRelatedField (zorunlu FK).
        # status default 'active', document_ref/assigned_to opsiyonel.
        fields = [
            'id',
            'definition',
            'current_step',
            'subject',
            'status',
            'document_ref',
            'assigned_to',
        ]
        read_only_fields = ['id']
