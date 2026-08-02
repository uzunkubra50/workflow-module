from django.contrib import admin

from .models import (
    Delegation,
    GroupDefinitionPermission,
    Notification,
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
    # max_duration_days ve escalation_group (Faz 2 SLA) form ekranında zaten otomatik
    # görünür; max_duration_days ayrıca listede de görünsün diye list_display'e eklendi.
    list_display = (
        'definition',
        'order',
        'name',
        'responsible_group',
        'is_start',
        'is_end',
        'max_duration_days',
    )
    list_filter = ('definition',)
    ordering = ('definition', 'order')


class WorkflowTransitionAdmin(admin.ModelAdmin):
    list_display = ('definition', 'from_step', 'to_step', 'action_name', 'action_type')
    list_filter = ('definition', 'action_type')


class WorkflowInstanceAdmin(admin.ModelAdmin):
    # description alanı burada listelenmiyor (TextField, tabloyu bozar); form ekranında
    # zaten düzenlenebilir — herhangi bir readonly_fields kısıtı yok, ekstra kod gerekmez.
    list_display = (
        'subject',
        'definition',
        'current_step',
        'status',
        'assigned_to',
        'created_by',
    )
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


# --- Vekalet ---


class DelegationAdmin(admin.ModelAdmin):
    list_display = ('delegator', 'delegate', 'start_date', 'end_date', 'is_active')
    list_filter = ('is_active',)


# --- Bildirim ---


class NotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'message', 'is_read', 'created_at')
    list_filter = ('is_read',)


# --- Grup bazlı süreç yetkisi ---


class GroupDefinitionPermissionAdmin(admin.ModelAdmin):
    list_display = ('group', 'definition')
    list_filter = ('group', 'definition')


# --- Kayıtlar ---

admin.site.register(Unit, UnitAdmin)
admin.site.register(WorkflowDefinition, WorkflowDefinitionAdmin)
admin.site.register(WorkflowStep, WorkflowStepAdmin)
admin.site.register(WorkflowTransition, WorkflowTransitionAdmin)
admin.site.register(WorkflowInstance, WorkflowInstanceAdmin)
admin.site.register(WorkflowAction, WorkflowActionAdmin)
admin.site.register(Delegation, DelegationAdmin)
admin.site.register(Notification, NotificationAdmin)
admin.site.register(GroupDefinitionPermission, GroupDefinitionPermissionAdmin)

