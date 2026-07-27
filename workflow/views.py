from django.core.exceptions import ValidationError
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from . import services
from .models import WorkflowDefinition, WorkflowInstance, WorkflowTransition
from .serializers import (
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

    queryset = WorkflowInstance.objects.all()  # Şimdilik hepsi; kullanıcıya göre filtre Faz 2.

    def get_serializer_class(self):
        # Liste hafif (ad gösterimi), create yazma amaçlı (FK'ler yazılabilir),
        # retrieve/perform-action ağır detay serializer'ı kullanır.
        if self.action == 'list':
            return WorkflowInstanceListSerializer
        if self.action == 'create':
            return WorkflowInstanceCreateSerializer
        return WorkflowInstanceDetailSerializer

    # TODO: ileride create sırasında current_step otomatik olarak is_start=True adımına
    # atanabilir; şimdilik current_step request'te verilir (fazla mantık eklenmedi).

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
