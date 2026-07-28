from django.contrib import admin

from .models import (
    Unit,
    WorkflowAction,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStep,
    WorkflowTransition,
)


# --- Inline'lar: bir süreç tanımını, adımlarını ve geçişlerini tek ekranda gir (Karar 2) ---


class WorkflowStepInline(admin.TabularInline):
    model = WorkflowStep
    extra = 1


class WorkflowTransitionInline(admin.TabularInline):
    model = WorkflowTransition
    extra = 1
    fk_name = 'definition'


# --- ModelAdmin sınıfları ---


class UnitAdmin(admin.ModelAdmin):
    list_display = ('name', 'code')


class WorkflowDefinitionAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'unit', 'is_active')
    list_filter = ('is_active', 'unit')
    inlines = [WorkflowStepInline, WorkflowTransitionInline]


class WorkflowStepAdmin(admin.ModelAdmin):
    list_display = ('definition', 'order', 'name', 'responsible_group', 'is_start', 'is_end')
    list_filter = ('definition',)
    ordering = ('definition', 'order')


class WorkflowTransitionAdmin(admin.ModelAdmin):
    list_display = ('definition', 'from_step', 'to_step', 'action_name', 'action_type')
    list_filter = ('definition', 'action_type')


class WorkflowInstanceAdmin(admin.ModelAdmin):
    list_display = ('subject', 'definition', 'current_step', 'status', 'assigned_to')
    list_filter = ('status', 'definition')


class WorkflowActionAdmin(admin.ModelAdmin):
    list_display = (
        'instance',
        'from_step',
        'to_step',
        'action_name',
        'performed_by',
        'created_at',
    )
    list_filter = ('action_type', 'created_at')


# --- Kayıtlar ---

admin.site.register(Unit, UnitAdmin)
admin.site.register(WorkflowDefinition, WorkflowDefinitionAdmin)
admin.site.register(WorkflowStep, WorkflowStepAdmin)
admin.site.register(WorkflowTransition, WorkflowTransitionAdmin)
admin.site.register(WorkflowInstance, WorkflowInstanceAdmin)
admin.site.register(WorkflowAction, WorkflowActionAdmin)
