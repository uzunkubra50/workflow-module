from django.core.exceptions import ValidationError
from django.db import transaction

from .models import WorkflowAction, WorkflowInstance, WorkflowTransition


def get_available_transitions(instance):
    """Bir WorkflowInstance'ın mevcut adımından yapabileceği izinli geçişleri döndürür.

    Karar 7: Bu doğrulama mantığı modelde değil serviste tutulur.

    Girdi:
        instance (WorkflowInstance): geçişleri hesaplanacak yürüyen süreç.

    Döndürür:
        QuerySet[WorkflowTransition]: current_step'ten çıkan, aynı definition'a ait
        geçişler (action_type, id'ye göre sıralı). Aşağıdaki durumlarda BOŞ queryset:
          - instance aktif değilse (tamamlandı/iptal) — biten işte aksiyon olmaz,
          - current_step None ise (savunmacı kontrol).

    Yan etki yoktur; yalnızca sorgular ve döndürür.
    """
    if instance.status != WorkflowInstance.Status.ACTIVE:
        return WorkflowTransition.objects.none()

    if instance.current_step is None:
        return WorkflowTransition.objects.none()

    # current_step'ten ÇIKAN geçişler (related_name='outgoing_transitions'),
    # ayrıca aynı definition'a daraltılır ki başka bir tanımın geçişi karışmasın.
    return (
        instance.current_step.outgoing_transitions
        .filter(definition=instance.definition)
        .order_by('action_type', 'id')
    )


def perform_transition(instance, transition, user, note=""):
    """Bir WorkflowInstance'ı seçilen geçiş üzerinden bir sonraki adıma taşır.

    Karar 7: geçişin izinli olup olmadığı serviste doğrulanır, veritabanı kısıtı olarak
    değil.

    Girdi:
        instance (WorkflowInstance): taşınacak yürüyen süreç.
        transition (WorkflowTransition): uygulanacak geçiş.
        user: aksiyonu yapan kullanıcı (WorkflowAction.performed_by'a yazılır).
        note (str): opsiyonel açıklama notu.

    Yapar:
        - transition, instance'ın mevcut adımından izinli geçişler içinde değilse
          hiçbir değişiklik yapmadan ValidationError fırlatır.
        - transaction.atomic() içinde (ya hep ya hiç): current_step'i transition.to_step
          yapar, hedef adım bitiş adımıysa status'u COMPLETED'a çeker, instance'ı kaydeder
          ve bir WorkflowAction (audit) kaydı oluşturur.

    Fırlatır:
        django.core.exceptions.ValidationError: geçiş şu anki adımdan yapılamıyorsa.

    Döndürür:
        WorkflowAction: oluşturulan geçmiş kaydı.
    """
    # 1) DOĞRULAMA: seçilen geçiş, mevcut adımdan izinli geçişler arasında mı?
    available_transitions = get_available_transitions(instance)
    if not available_transitions.filter(pk=transition.pk).exists():
        raise ValidationError("Bu geçiş şu anki adımdan yapılamaz.")

    # 2) Atomik blok: aşağıdaki adımlardan biri patlarsa hepsi geri alınır.
    with transaction.atomic():
        from_step = instance.current_step  # geçişten ÖNCEki adım — audit için sakla

        instance.current_step = transition.to_step
        if transition.to_step.is_end:
            instance.status = WorkflowInstance.Status.COMPLETED
        instance.save()

        action = WorkflowAction.objects.create(
            instance=instance,
            from_step=from_step,
            to_step=transition.to_step,
            performed_by=user,
            note=note,
        )

    # 3) Çağıran taraf sonucu görebilsin diye oluşturulan audit kaydını döndür.
    return action
