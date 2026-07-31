from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from .models import Delegation, Notification, WorkflowAction, WorkflowInstance, WorkflowTransition


def notify(user, message, instance=None):
    """Kullanıcıya uygulama-içi bildirim oluşturur (Faz 3). SMTP/e-posta YOK,
    yalnızca veritabanına yazılır; frontend bell ikonuyla gösterir."""
    Notification.objects.create(recipient=user, message=message, instance=instance)


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


def get_effective_users(user):
    """Kullanıcının adına hareket edebileceği kişilerin listesini döndürür.

    Vekalet mantığı: bugünün tarihi start_date–end_date aralığında olan ve
    is_active=True olan Delegation kayıtlarında delegate=user olanların
    delegator'larını toplar.

    Döndürür:
        list[User]: [user] + [vekaleten temsil edilen delegator'lar]
    """
    today = timezone.now().date()
    # Bu kullanıcıya verilmiş ve bugün geçerli olan aktif vekaletler.
    delegator_ids = (
        Delegation.objects.filter(
            delegate=user,
            is_active=True,
            start_date__lte=today,
            end_date__gte=today,
        )
        .values_list('delegator_id', flat=True)
    )
    # Kendisi + vekili olduğu kişiler. Delegator nesneleri lazy olarak çekilir.
    from django.contrib.auth import get_user_model
    User = get_user_model()
    delegators = list(User.objects.filter(pk__in=delegator_ids))
    return [user] + delegators


def can_user_perform(user, instance):
    """Kullanıcının, instance'ın MEVCUT adımında aksiyon alıp alamayacağını kontrol eder.

    Faz 2, rol/yetki kısıtı + vekalet desteği: bir kullanıcı ancak bulunduğu adımın
    responsible_group'una (kendisi VEYA vekili olduğu kişilerden biri aracılığıyla)
    üyeyse aksiyon alabilir. Kontrol sırası:
        1. user yok / anonim ise -> False.
        2. user.is_superuser ise -> True (yönetici acil müdahale için her zaman yetkili).
        3. instance.current_step None ise -> False (savunmacı kontrol).
        4. current_step.responsible_group None ise -> True (sorumlu grup atanmamışsa
           kısıt yok: "kimse sorumlu değil" = "herkes yapabilir").
        5. Aksi halde: effective_users (user + vekili olduğu kişiler) içinden
           herhangi biri responsible_group'a üye mi?

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

    # Vekalet desteği: kullanıcı + vekili olduğu kişilerin herhangi birinin
    # sorumlu gruba üye olup olmadığını kontrol et.
    effective_users = get_effective_users(user)
    for u in effective_users:
        if u.groups.filter(pk=responsible_group.pk).exists():
            return True
    return False


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
          yapar, hedef adım bitiş adımıysa status'u COMPLETED'a (reddeden bir geçişse
          REJECTED'a) çeker, instance'ı kaydeder ve bir WorkflowAction (audit) kaydı
          oluşturur (o anki action_type/action_name da kaydın üzerine kopyalanır).

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
            if transition.action_type == WorkflowTransition.ActionType.REJECT:
                instance.status = WorkflowInstance.Status.REJECTED
            else:
                instance.status = WorkflowInstance.Status.COMPLETED
        instance.save()

        action = WorkflowAction.objects.create(
            instance=instance,
            from_step=from_step,
            to_step=transition.to_step,
            action_type=transition.action_type,
            action_name=transition.action_name,
            performed_by=user,
            note=note,
        )

    # 3) BİLDİRİM (Faz 3): atomic bloğun DIŞINDA ve try/except ile — bildirim
    #    oluşturma patlarsa bile geçiş kendisi (yukarıdaki asıl işlem) başarısız
    #    OLMASIN, bu yalnızca bir yan etki.
    try:
        new_step = transition.to_step
        if new_step.responsible_group is not None:
            for member in new_step.responsible_group.user_set.all():
                notify(
                    member,
                    f"'{instance.subject}' işi '{new_step.name}' adımına geldi, "
                    f"sizin onayınızı bekliyor.",
                    instance,
                )

        # Süreç bittiyse (Onaylandı/Reddedildi) işi başlatan kişiye de haber ver.
        # Basitlik için created_by, yukarıdaki responsible_group listesindeyse bile
        # ayrıca bildirim gider — tekrar kontrolü gerekmeyecek kadar küçük bir maliyet.
        if instance.status in (
            WorkflowInstance.Status.COMPLETED,
            WorkflowInstance.Status.REJECTED,
        ) and instance.created_by is not None:
            notify(
                instance.created_by,
                f"Başlattığınız '{instance.subject}' işi "
                f"'{instance.get_status_display()}' oldu.",
                instance,
            )
    except Exception:
        pass

    # 4) Çağıran taraf sonucu görebilsin diye oluşturulan audit kaydını döndür.
    return action
