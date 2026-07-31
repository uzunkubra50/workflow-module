from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DelegationViewSet,
    UserListView,
    WorkflowDefinitionViewSet,
    WorkflowInstanceViewSet,
)

router = DefaultRouter()
# Prefix 'instances' -> /api/instances/ , /api/instances/{id}/ ,
# /api/instances/{id}/perform-action/
router.register(r'instances', WorkflowInstanceViewSet, basename='workflowinstance')
# Prefix 'definitions' -> /api/definitions/ , /api/definitions/{id}/ (salt okuma)
router.register(r'definitions', WorkflowDefinitionViewSet, basename='workflowdefinition')
# Prefix 'delegations' -> /api/delegations/ (list, create), /api/delegations/{id}/ (retrieve, delete)
router.register(r'delegations', DelegationViewSet, basename='delegation')

urlpatterns = router.urls + [
    # Vekalet formundaki vekil seçimi için kullanıcı listesi.
    path('users/', UserListView.as_view(), name='user-list'),
]


