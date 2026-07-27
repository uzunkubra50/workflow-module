from rest_framework.routers import DefaultRouter

from .views import WorkflowDefinitionViewSet, WorkflowInstanceViewSet

router = DefaultRouter()
# Prefix 'instances' -> /api/instances/ , /api/instances/{id}/ ,
# /api/instances/{id}/perform-action/
router.register(r'instances', WorkflowInstanceViewSet, basename='workflowinstance')
# Prefix 'definitions' -> /api/definitions/ , /api/definitions/{id}/ (salt okuma)
router.register(r'definitions', WorkflowDefinitionViewSet, basename='workflowdefinition')

urlpatterns = router.urls
