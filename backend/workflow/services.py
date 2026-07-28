from django.core.exceptions import PermissionDenied, ValidationError
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


def can_user_perform(user, instance):
    """Kullanıcının, instance'ın MEVCUT adımında aksiyon alıp alamayacağını kontrol eder.

    Faz 2, rol/yetki kısıtı: bir kullanıcı ancak bulunduğu adımın responsible_group'una
    üyeyse aksiyon alabilir. Kontrol sırası:
        1. user yok / anonim ise -> False.
        2. user.is_superuser ise -> True (yönetici acil müdahale için her zaman yetkili).
        3. instance.current_step None ise -> False (savunmacı kontrol).
        4. current_step.responsible_group None ise -> True (sorumlu grup atanmamışsa
           kısıt yok: "kimse sorumlu değil" = "herkes yapabilir").
        5. Aksi halde: user, o responsible_group'a üye mi?

    Girdi:
        user: aksiyonu almak isteyen kullanıcı (AnonymousUser da olabilir).
        instance (WorkflowInstance): mevcut adımı kontrol edilecek yürüyen süreç.

    Döndürür:
        bool
    """
    if user is None or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    if instance.current_step is None:
        return False

    responsible_group = instance.current_step.responsible_group
    if responsible_group is None:
        return True

    return user.groups.filter(pk=responsible_group.pk).exists()


def perform_transition(instance, transition, user, note=""):
    """Bir WorkflowInstance'ı seçilen geçiş üzerinden bir sonraki adıma taşır.

    Karar 7: geçişin izinli olup olmadığı serviste doğrulanır, veritabanı kısıtı olarak
    değil. Faz 2: kullanıcının bu adımda aksiyon alma YETKİSİ de (can_user_perform) en
    başta, geçiş doğrulamasından önce kontrol edilir.

    Girdi:
        instance (WorkflowInstance): taşınacak yürüyen süreç.
        transition (WorkflowTransition): uygulanacak geçiş.
        user: aksiyonu yapan kullanıcı (WorkflowAction.performed_by'a yazılır).
        note (str): opsiyonel açıklama notu.

    Yapar:
        - Kullanıcı bu adımda yetkili değilse (can_user_perform False) hiçbir değişiklik
          yapmadan PermissionDenied fırlatır.
        - transition, instance'ın mevcut adımından izinli geçişler içinde değilse
          hiçbir değişiklik yapmadan ValidationError fırlatır.
        - transaction.atomic() içinde (ya hep ya hiç): current_step'i transition.to_step
          yapar, hedef adım bitiş adımıysa status'u COMPLETED'a çeker, instance'ı kaydeder
          ve bir WorkflowAction (audit) kaydı oluşturur.

    Fırlatır:
        django.core.exceptions.PermissionDenied: kullanıcı bu adımda yetkili değilse.
        django.core.exceptions.ValidationError: geçiş şu anki adımdan yapılamıyorsa.

    Döndürür:
        WorkflowAction: oluşturulan geçmiş kaydı.
    """
    # 0) YETKİ KONTROLÜ: kullanıcı bu adımda aksiyon alabilir mi? (Faz 2)
    if not can_user_perform(user, instance):
        responsible_group = (
            instance.current_step.responsible_group if instance.current_step else None
        )
        if responsible_group is not None:
            raise PermissionDenied(
                f"Bu adımda işlem yapma yetkiniz yok. Sorumlu grup: {responsible_group.name}"
            )
        raise PermissionDenied("Bu adımda işlem yapma yetkiniz yok.")

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
