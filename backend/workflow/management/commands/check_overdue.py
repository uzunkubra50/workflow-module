from django.core.management.base import BaseCommand

from workflow.services import check_and_escalate


class Command(BaseCommand):
    """Faz 2 SLA: süresi geçen (is_overdue) aktif işleri tarar ve eskalasyon
    grubuna bildirim gönderir.

    Gerçek bir sistemde bu komut cron/Celery ile periyodik olarak (örn. günde bir
    kez) otomatik çalıştırılırdı. Bu staj kapsamında zamanlanmış görev altyapısı
    (cron/Celery) kurulmuyor — komut elle tetikleniyor:

        python manage.py check_overdue
    """

    help = "Süresi geçen (is_overdue) aktif işleri eskalasyona uğratır ve bildirim gönderir."

    def handle(self, *args, **options):
        count = check_and_escalate()
        self.stdout.write(self.style.SUCCESS(f"{count} iş eskalasyona uğradı."))
