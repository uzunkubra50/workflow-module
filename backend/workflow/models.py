from django.conf import settings
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db import models


class Unit(models.Model):
    """Modül bağımsız çalıştığı için app içinde tanımlanan basit birim modeli.
    WorkflowDefinition.unit FK'sinin bağlanacağı hedef (bkz. CLAUDE.md, Bölüm 5 notu)."""

    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)

    def __str__(self):
        return self.name


# --- ŞABLON MODELLERİ (bir kez tanımlanır, birçok işte tekrar kullanılır) ---


class WorkflowDefinition(models.Model):
    """Süreç şablonu. Örn. 'Ruhsat Başvuru Süreci'."""

    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50)
    unit = models.ForeignKey(
        Unit,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class WorkflowStep(models.Model):
    """Bir şablona ait adım/durak. Örn. 'Teknik İnceleme', 'Müdür Onayı'."""

    definition = models.ForeignKey(
        WorkflowDefinition,
        on_delete=models.CASCADE,
        related_name='steps',
    )
    name = models.CharField(max_length=150)
    order = models.PositiveIntegerField()
    responsible_group = models.ForeignKey(
        Group,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    is_start = models.BooleanField(default=False)
    is_end = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.order}. {self.name}"


class WorkflowTransition(models.Model):
    """Adımlar arasında izin verilen hareketler. İade/geri dönüşler de birer geçiştir."""

    class ActionType(models.TextChoices):
        APPROVE = 'approve', 'Onayla'
        REJECT = 'reject', 'Reddet'
        RETURN = 'return', 'İade'

    definition = models.ForeignKey(
        WorkflowDefinition,
        on_delete=models.CASCADE,
        related_name='transitions',
    )
    from_step = models.ForeignKey(
        WorkflowStep,
        on_delete=models.CASCADE,
        related_name='outgoing_transitions',
    )
    to_step = models.ForeignKey(
        WorkflowStep,
        on_delete=models.CASCADE,
        related_name='incoming_transitions',
    )
    action_name = models.CharField(max_length=100)
    action_type = models.CharField(
        max_length=20,
        choices=ActionType.choices,
    )

    def __str__(self):
        return f"{self.from_step.name} → {self.to_step.name} ({self.action_name})"


# --- ÇALIŞMA ZAMANI MODELLERİ (her iş için yeniden üretilir) ---


class WorkflowInstance(models.Model):
    """Şablonun gerçek bir işe uygulanmış, yürüyen hali."""

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Aktif'
        COMPLETED = 'completed', 'Tamamlandı'
        REJECTED = 'rejected', 'Reddedildi'

    definition = models.ForeignKey(
        WorkflowDefinition,
        on_delete=models.PROTECT,
    )
    subject = models.CharField(max_length=255)
    # Karar 8: devam eden bir iş, tanım güncellenirken yarıda kalmasın diye PROTECT.
    current_step = models.ForeignKey(
        WorkflowStep,
        on_delete=models.PROTECT,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    # Mentör geri bildirimi: işi kimin başlattığının kaydı. related_name ZORUNLU —
    # assigned_to da aynı modele (User) FK, related_name verilmezse ikisi de varsayılan
    # 'workflowinstance_set' adını ister ve Django E304 (reverse accessor çakışması) verir.
    # SET_NULL: kullanıcı silinirse iş etkilenmesin, sadece "kim başlattı" bilgisi kaybolsun.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_instances',
        verbose_name='Başlatan',
    )
    # Karar 1 / Ek not: FK DEĞİL — belge başka bir veritabanında olabilir, serbest kimlik.
    document_ref = models.CharField(max_length=255, blank=True)
    # Serbest açıklama/detay metni (mentör geri bildirimi) — örn. imha sürecinde hangi
    # evrakların imha edileceğinin listesi gibi ek bilgiler.
    description = models.TextField(blank=True, verbose_name='Açıklama')
    # Ekran 2.1 listede tarih gösterir. Türetilemez: yeni açılan işin henüz hiç
    # WorkflowAction kaydı olmadığı için geçmişten tarih çıkarmak mümkün değil.
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.subject} [{self.get_status_display()}]"


class WorkflowAction(models.Model):
    """İşlem geçmişi / audit trail: kim, ne zaman, hangi adımdan hangi adıma geçti."""

    instance = models.ForeignKey(
        WorkflowInstance,
        on_delete=models.CASCADE,
        related_name='actions',
    )
    from_step = models.ForeignKey(
        WorkflowStep,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    to_step = models.ForeignKey(
        WorkflowStep,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    # Hangi aksiyonun seçildiğinin anlık görüntüsü: FK değil, o anki transition'dan kopyalanır.
    # Böylece transition daha sonra silinse/değişse bile geçmiş kaydı bozulmaz. Aynı (from_step,
    # to_step) çiftine birden fazla aksiyon (örn. Onayla/Reddet) bağlı olabildiği için gereklidir.
    action_type = models.CharField(
        max_length=20,
        choices=WorkflowTransition.ActionType.choices,
        blank=True,
    )
    action_name = models.CharField(max_length=100, blank=True)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        frm = self.from_step.name if self.from_step else '—'
        to = self.to_step.name if self.to_step else '—'
        return f"{self.instance.subject}: {frm} → {to}"


# --- VEKALET MODELİ (bir kullanıcının işlerini geçici olarak başka birine devretmesi) ---


class Delegation(models.Model):
    """Vekalet kaydı: delegator, belirli bir tarih aralığında kendi adına
    delegate'in işlem yapmasına izin verir. SAP/Oracle/Dynamics standart özelliği."""

    delegator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='delegations_given',
        verbose_name='Vekalet Veren',
    )
    delegate = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='delegations_received',
        verbose_name='Vekil',
    )
    start_date = models.DateField(verbose_name='Başlangıç')
    end_date = models.DateField(verbose_name='Bitiş')
    is_active = models.BooleanField(default=True, verbose_name='Aktif')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.delegator} → {self.delegate} ({self.start_date} - {self.end_date})"

    def clean(self):
        """Tarih ve kendi-kendine vekalet validasyonları."""
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValidationError('Bitiş tarihi başlangıçtan önce olamaz.')
        if self.delegator_id and self.delegate_id and self.delegator_id == self.delegate_id:
            raise ValidationError('Kişi kendine vekalet veremez.')

