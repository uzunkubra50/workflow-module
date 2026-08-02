from rest_framework.routers import DefaultRouter

from .views import (
    DelegationViewSet,
    GroupViewSet,
    NotificationViewSet,
    UserViewSet,
    WorkflowDefinitionViewSet,
    WorkflowInstanceViewSet,
    WorkflowStepAdminViewSet,
    WorkflowTransitionAdminViewSet,
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
# Prefix 'users' -> /api/users/ (vekil seçimi ya da Rol/Yetki Yönetimi, kullanıcıya
# göre değişir), /api/users/{id}/groups/ , /api/users/{id}/permissions/
router.register(r'users', UserViewSet, basename='user')
# Prefix 'groups' -> /api/groups/ — grup seçim dropdown'ı için basit liste.
router.register(r'groups', GroupViewSet, basename='group')
# Süreç Tasarlama ekranı (staff-only, tam CRUD) — 'admin/' önekiyle, mevcut salt-okuma
# /api/definitions/{id}/steps/ ve /transitions/ uçlarıyla KARIŞMASIN diye ayrı prefix.
# Prefix 'admin/steps' -> /api/admin/steps/ , /api/admin/steps/{id}/
router.register(r'admin/steps', WorkflowStepAdminViewSet, basename='workflowstep-admin')
# Prefix 'admin/transitions' -> /api/admin/transitions/ , /api/admin/transitions/{id}/
router.register(
    r'admin/transitions', WorkflowTransitionAdminViewSet, basename='workflowtransition-admin'
)

urlpatterns = router.urls


