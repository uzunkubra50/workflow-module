from rest_framework.routers import DefaultRouter

from .views import WorkflowInstanceViewSet

router = DefaultRouter()
# Prefix 'instances' -> /api/instances/ , /api/instances/{id}/ ,
# /api/instances/{id}/perform-action/
router.register(r'instances', WorkflowInstanceViewSet, basename='workflowinstance')

urlpatterns = router.urls
