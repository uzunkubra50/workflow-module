from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DelegationViewSet,
    NotificationViewSet,
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
# Prefix 'notifications' -> /api/notifications/ , /api/notifications/{id}/ ,
# /api/notifications/unread-count/ , /api/notifications/{id}/mark-read/ ,
# /api/notifications/mark-all-read/
router.register(r'notifications', NotificationViewSet, basename='notification')

urlpatterns = router.urls + [
    # Vekalet formundaki vekil seçimi için kullanıcı listesi.
    path('users/', UserListView.as_view(), name='user-list'),
]


