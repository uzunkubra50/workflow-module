"""workflow uygulamasının testleri.

Ağırlık servis katmanındadır (Karar 7): geçiş doğrulama, yetki kontrolü ve durum
geçişleri iş mantığının kalbi olduğu için önce onlar test edilir. Ardından aynı
kuralların HTTP katmanında doğru koda çevrildiği (403 / 400 / 200) doğrulanır.
"""

from django.contrib.auth.models import AnonymousUser, Group, User
from django.core.cache import cache
from django.core.exceptions import PermissionDenied, ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
    Unit,
    WorkflowAction,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStep,
    WorkflowTransition,
)
from .services import can_user_perform, get_available_transitions, perform_transition


class WorkflowTestBase(TestCase):
    """Tüm testlerin paylaştığı küçük süreç şablonu.

    Gerçek "Ruhsat Başvuru Süreci"nin sadeleştirilmiş hali: üç adım, ileri/geri
    geçişler ve bitiş adımına giden İKİ ayrı aksiyon (Onayla/Reddet). Son madde
    önemli — aynı (from_step, to_step) çiftine birden fazla aksiyon bağlanabildiği
    için geçmişte hangisinin seçildiğinin ayrıca saklanması gerekiyor.

        Başvuru ──Gönder──> İnceleme ──Onayla──> Sonuçlandı
                                │    ──Reddet──> Sonuçlandı
                                └────İade─────> Başvuru
    """

    def setUp(self):
        self.grup_evrak = Group.objects.create(name='Evrak Birimi')
        self.grup_mudur = Group.objects.create(name='Müdür')

        self.user_evrak = User.objects.create_user('evrak_user', password='x')
        self.user_evrak.groups.add(self.grup_evrak)

        self.user_mudur = User.objects.create_user('mudur_user', password='x')
        self.user_mudur.groups.add(self.grup_mudur)

        # Hiçbir gruba üye olmayan kullanıcı — yetki kontrolünün alt sınırı.
        self.user_bagimsiz = User.objects.create_user('bagimsiz_user', password='x')

        self.admin = User.objects.create_superuser('admin_user', password='x')

        self.unit = Unit.objects.create(name='Test Birimi', code='TB')
        self.definition = WorkflowDefinition.objects.create(
            name='Test Süreci', code='TEST', unit=self.unit
        )

        self.step_basvuru = WorkflowStep.objects.create(
            definition=self.definition,
            name='Başvuru',
            order=1,
            responsible_group=self.grup_evrak,
            is_start=True,
        )
        self.step_inceleme = WorkflowStep.objects.create(
            definition=self.definition,
            name='İnceleme',
            order=2,
            responsible_group=self.grup_mudur,
        )
        # Bitiş adımının sorumlu grubu YOK — burada aksiyon alınmayacak.
        self.step_sonuc = WorkflowStep.objects.create(
            definition=self.definition,
            name='Sonuçlandı',
            order=3,
            responsible_group=None,
            is_end=True,
        )

        self.t_gonder = WorkflowTransition.objects.create(
            definition=self.definition,
            from_step=self.step_basvuru,
            to_step=self.step_inceleme,
            action_name='Gönder',
            action_type=WorkflowTransition.ActionType.APPROVE,
        )
        self.t_iade = WorkflowTransition.objects.create(
            definition=self.definition,
            from_step=self.step_inceleme,
            to_step=self.step_basvuru,
            action_name='İade',
            action_type=WorkflowTransition.ActionType.RETURN,
        )
        self.t_onayla = WorkflowTransition.objects.create(
            definition=self.definition,
            from_step=self.step_inceleme,
            to_step=self.step_sonuc,
            action_name='Onayla',
            action_type=WorkflowTransition.ActionType.APPROVE,
        )
        self.t_reddet = WorkflowTransition.objects.create(
            definition=self.definition,
            from_step=self.step_inceleme,
            to_step=self.step_sonuc,
            action_name='Reddet',
            action_type=WorkflowTransition.ActionType.REJECT,
        )

        self.instance = WorkflowInstance.objects.create(
            definition=self.definition,
            subject='Test başvurusu',
            current_step=self.step_basvuru,
            status=WorkflowInstance.Status.ACTIVE,
            document_ref='TEST-001',
        )


class GetAvailableTransitionsTests(WorkflowTestBase):
    """Bir işin mevcut adımından hangi geçişlerin görünmesi gerektiği."""

    def test_aktif_isin_mevcut_adimindan_cikan_gecisler_doner(self):
        transitions = get_available_transitions(self.instance)
        self.assertEqual(list(transitions), [self.t_gonder])

    def test_ara_adimda_tum_cikan_gecisler_doner(self):
        self.instance.current_step = self.step_inceleme
        self.instance.save()
        transitions = get_available_transitions(self.instance)
        self.assertCountEqual(
            list(transitions), [self.t_iade, self.t_onayla, self.t_reddet]
        )

    def test_tamamlanmis_is_icin_bos_doner(self):
        """Biten işte aksiyon olmaz — adımda tanımlı geçiş olsa bile."""
        self.instance.status = WorkflowInstance.Status.COMPLETED
        self.instance.save()
        self.assertEqual(list(get_available_transitions(self.instance)), [])

    def test_reddedilmis_is_icin_bos_doner(self):
        self.instance.status = WorkflowInstance.Status.REJECTED
        self.instance.save()
        self.assertEqual(list(get_available_transitions(self.instance)), [])

    def test_bitis_adiminda_cikan_gecis_yoktur(self):
        self.instance.current_step = self.step_sonuc
        self.instance.save()
        self.assertEqual(list(get_available_transitions(self.instance)), [])

    def test_baska_tanimin_gecisi_karismaz(self):
        """Aynı adımdan çıkan ama BAŞKA bir tanıma ait geçiş listeye girmemeli.

        Veritabanı bunu engellemiyor (from_step ile definition arasında kısıt yok),
        bu yüzden servisteki definition filtresi savunmacı bir kontrol.
        """
        other_definition = WorkflowDefinition.objects.create(
            name='Diğer Süreç', code='OTHER'
        )
        WorkflowTransition.objects.create(
            definition=other_definition,
            from_step=self.step_basvuru,
            to_step=self.step_inceleme,
            action_name='Yabancı Geçiş',
            action_type=WorkflowTransition.ActionType.APPROVE,
        )
        transitions = get_available_transitions(self.instance)
        self.assertEqual(list(transitions), [self.t_gonder])


class CanUserPerformTests(WorkflowTestBase):
    """Faz 2 yetki kısıtı: kullanıcı bulunduğu adımda aksiyon alabilir mi?"""

    def test_sorumlu_gruptaki_kullanici_yetkilidir(self):
        self.assertTrue(can_user_perform(self.user_evrak, self.instance))

    def test_farkli_gruptaki_kullanici_yetkisizdir(self):
        # Müdür, "Başvuru" adımının sorumlusu değil.
        self.assertFalse(can_user_perform(self.user_mudur, self.instance))

    def test_hicbir_gruba_uye_olmayan_kullanici_yetkisizdir(self):
        self.assertFalse(can_user_perform(self.user_bagimsiz, self.instance))

    def test_superuser_her_adimda_yetkilidir(self):
        """Yönetici acil müdahale için grup üyeliğinden bağımsız yetkilidir."""
        self.assertTrue(can_user_perform(self.admin, self.instance))
        self.instance.current_step = self.step_inceleme
        self.assertTrue(can_user_perform(self.admin, self.instance))

    def test_anonim_kullanici_yetkisizdir(self):
        self.assertFalse(can_user_perform(AnonymousUser(), self.instance))

    def test_user_none_ise_yetkisizdir(self):
        self.assertFalse(can_user_perform(None, self.instance))

    def test_sorumlu_grup_atanmamissa_herkes_yetkilidir(self):
        """"Kimse sorumlu değil" = "kısıt yok" (can_user_perform 4. kural)."""
        self.instance.current_step = self.step_sonuc  # responsible_group=None
        self.assertTrue(can_user_perform(self.user_bagimsiz, self.instance))

    def test_adim_degisince_yetki_de_degisir(self):
        """Aynı kullanıcı bir adımda yetkili, diğerinde değil."""
        self.assertTrue(can_user_perform(self.user_evrak, self.instance))
        self.instance.current_step = self.step_inceleme
        self.assertFalse(can_user_perform(self.user_evrak, self.instance))


class PerformTransitionTests(WorkflowTestBase):
    """Geçişin uygulanması: adım ilerlemesi, durum ve geçmiş kaydı."""

    def test_basarili_gecis_adimi_ilerletir(self):
        perform_transition(self.instance, self.t_gonder, self.user_evrak)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_inceleme)
        self.assertEqual(self.instance.status, WorkflowInstance.Status.ACTIVE)

    def test_gecmis_kaydi_aksiyon_bilgisiyle_olusur(self):
        """Geçmişe action_type/action_name de yazılmalı.

        Aksi halde "İnceleme → Sonuçlandı" satırına bakıp onaylandı mı
        reddedildi mi ayırt edilemez.
        """
        action = perform_transition(
            self.instance, self.t_gonder, self.user_evrak, note='ilk adım'
        )
        self.assertEqual(action.from_step, self.step_basvuru)
        self.assertEqual(action.to_step, self.step_inceleme)
        self.assertEqual(action.performed_by, self.user_evrak)
        self.assertEqual(action.note, 'ilk adım')
        self.assertEqual(action.action_name, 'Gönder')
        self.assertEqual(action.action_type, WorkflowTransition.ActionType.APPROVE)

    def test_onayla_bitis_adimina_giderse_tamamlandi_olur(self):
        self.instance.current_step = self.step_inceleme
        self.instance.save()
        perform_transition(self.instance, self.t_onayla, self.user_mudur)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, WorkflowInstance.Status.COMPLETED)

    def test_reddet_bitis_adimina_giderse_reddedildi_olur(self):
        """Reddedilen iş "Tamamlandı" görünmemeli — ayrı durum almalı."""
        self.instance.current_step = self.step_inceleme
        self.instance.save()
        perform_transition(self.instance, self.t_reddet, self.user_mudur)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, WorkflowInstance.Status.REJECTED)
        self.assertEqual(self.instance.current_step, self.step_sonuc)

    def test_ara_adima_gecis_isi_aktif_birakir(self):
        """Hedef adım bitiş değilse durum değişmez."""
        perform_transition(self.instance, self.t_gonder, self.user_evrak)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, WorkflowInstance.Status.ACTIVE)

    def test_iade_gecisi_onceki_adima_dondurur(self):
        self.instance.current_step = self.step_inceleme
        self.instance.save()
        perform_transition(self.instance, self.t_iade, self.user_mudur)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_basvuru)
        self.assertEqual(self.instance.status, WorkflowInstance.Status.ACTIVE)

    def test_yetkisiz_kullanici_permissiondenied_alir(self):
        with self.assertRaises(PermissionDenied):
            perform_transition(self.instance, self.t_gonder, self.user_mudur)

    def test_permissiondenied_mesajinda_sorumlu_grup_gecer(self):
        with self.assertRaises(PermissionDenied) as ctx:
            perform_transition(self.instance, self.t_gonder, self.user_mudur)
        self.assertIn('Evrak Birimi', str(ctx.exception))

    def test_yetkisiz_denemede_hicbir_sey_degismez(self):
        """Yetki hatası, adımı ve geçmişi kesinlikle etkilememeli."""
        with self.assertRaises(PermissionDenied):
            perform_transition(self.instance, self.t_gonder, self.user_mudur)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_basvuru)
        self.assertEqual(WorkflowAction.objects.count(), 0)

    def test_bu_adimdan_tanimsiz_gecis_validationerror_alir(self):
        """"Onayla" geçişi İnceleme adımından çıkar; Başvuru adımında geçersiz."""
        with self.assertRaises(ValidationError):
            perform_transition(self.instance, self.t_onayla, self.user_evrak)

    def test_gecersiz_gecis_denemesinde_gecmis_kaydi_olusmaz(self):
        with self.assertRaises(ValidationError):
            perform_transition(self.instance, self.t_onayla, self.user_evrak)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_basvuru)
        self.assertEqual(WorkflowAction.objects.count(), 0)

    def test_tamamlanmis_iste_aksiyon_alinamaz(self):
        """Biten işte yetkili kullanıcı bile geçiş yapamaz."""
        self.instance.status = WorkflowInstance.Status.COMPLETED
        self.instance.save()
        with self.assertRaises(ValidationError):
            perform_transition(self.instance, self.t_gonder, self.admin)

    def test_yetki_kontrolu_gecis_dogrulamasindan_once_calisir(self):
        """Hem yetkisiz hem geçersiz durumda önce PermissionDenied gelmeli.

        Sıra önemli: kullanıcıya "bu geçiş yapılamaz" demek yerine yetkisi
        olmadığını söylemek doğru geri bildirimdir.
        """
        with self.assertRaises(PermissionDenied):
            perform_transition(self.instance, self.t_onayla, self.user_mudur)

    def test_pes_pese_gecisler_gecmisi_biriktirir(self):
        perform_transition(self.instance, self.t_gonder, self.user_evrak)
        perform_transition(self.instance, self.t_reddet, self.user_mudur)
        self.instance.refresh_from_db()
        actions = list(self.instance.actions.order_by('id'))
        self.assertEqual(len(actions), 2)
        self.assertEqual(actions[0].action_name, 'Gönder')
        self.assertEqual(actions[1].action_name, 'Reddet')
        self.assertEqual(self.instance.status, WorkflowInstance.Status.REJECTED)


class WorkflowInstanceAPITests(WorkflowTestBase):
    """Servisteki kuralların HTTP durum kodlarına doğru çevrildiği."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.detail_url = f'/api/instances/{self.instance.pk}/'
        self.action_url = f'/api/instances/{self.instance.pk}/perform-action/'

    def test_kimlik_dogrulamasiz_erisim_reddedilir(self):
        response = self.client.get('/api/instances/')
        self.assertIn(response.status_code, (401, 403))

    def test_yetkili_kullanici_listeyi_gorebilir(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get('/api/instances/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_liste_olusturma_tarihini_doner(self):
        """Ekran 2.1 listede tarih gösterir; created_at otomatik dolar."""
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get('/api/instances/')
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data[0]['created_at'])

    def test_detay_yetki_alanlarini_doner(self):
        """can_perform_action ve responsible_group, isteği yapan kullanıcıya göre."""
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get(self.detail_url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['can_perform_action'])
        self.assertEqual(response.data['responsible_group'], 'Evrak Birimi')

    def test_detay_yetkisiz_kullaniciya_false_doner(self):
        self.client.force_authenticate(user=self.user_mudur)
        response = self.client.get(self.detail_url)
        self.assertFalse(response.data['can_perform_action'])

    def test_detay_yalnizca_izinli_gecisleri_listeler(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get(self.detail_url)
        action_names = [t['action_name'] for t in response.data['available_transitions']]
        self.assertEqual(action_names, ['Gönder'])

    def test_yetkisiz_aksiyon_403_doner(self):
        self.client.force_authenticate(user=self.user_mudur)
        response = self.client.post(
            self.action_url, {'transition_id': self.t_gonder.pk}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_basvuru)

    def test_gecersiz_gecis_400_doner(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(
            self.action_url, {'transition_id': self.t_onayla.pk}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_transition_id_zorunludur(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(self.action_url, {}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_olmayan_transition_404_doner(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(
            self.action_url, {'transition_id': 999999}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    def test_yetkili_aksiyon_isi_ilerletir(self):
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(
            self.action_url,
            {'transition_id': self.t_gonder.pk, 'note': 'onaylandı'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['current_step'], 'İnceleme')
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_step, self.step_inceleme)

    def test_islem_gecmisi_endpointi_kronolojik_doner(self):
        perform_transition(self.instance, self.t_gonder, self.user_evrak)
        perform_transition(self.instance, self.t_iade, self.user_mudur)
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get(f'/api/instances/{self.instance.pk}/actions/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]['action_name'], 'Gönder')
        self.assertEqual(response.data[1]['action_name'], 'İade')

    def test_yeni_is_baslangic_adimina_atanir(self):
        """3.1 Yol C: current_step kullanıcıdan alınmaz, is_start adımı atanır."""
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(
            '/api/instances/',
            {'definition': self.definition.pk, 'subject': 'Yeni iş'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        created = WorkflowInstance.objects.get(pk=response.data['id'])
        self.assertEqual(created.current_step, self.step_basvuru)
        self.assertEqual(created.status, WorkflowInstance.Status.ACTIVE)

    def test_baslangic_adimi_olmayan_surecte_is_baslatilamaz(self):
        bos_definition = WorkflowDefinition.objects.create(
            name='Adımsız Süreç', code='EMPTY'
        )
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.post(
            '/api/instances/',
            {'definition': bos_definition.pk, 'subject': 'Olmayacak iş'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_keyfi_guncelleme_ve_silme_uclari_yoktur(self):
        """Karar 7/8: iş yalnızca tanımlı geçişlerle ilerler."""
        self.client.force_authenticate(user=self.admin)
        patch_response = self.client.patch(
            self.detail_url, {'subject': 'değişti'}, format='json'
        )
        self.assertEqual(patch_response.status_code, 405)
        self.assertEqual(self.client.delete(self.detail_url).status_code, 405)

    def test_definitions_yalnizca_aktif_surecleri_doner(self):
        WorkflowDefinition.objects.create(
            name='Pasif Süreç', code='PASSIVE', is_active=False
        )
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get('/api/definitions/')
        self.assertEqual(response.status_code, 200)
        codes = [d['code'] for d in response.data]
        self.assertIn('TEST', codes)
        self.assertNotIn('PASSIVE', codes)


class InstanceListFilterTests(WorkflowTestBase):
    """Ekran 2.1: liste, kullanıcının grubunun sorumlu olduğu işlerle sınırlıdır."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        # İkinci iş, Müdür grubunun sorumlu olduğu adımda duruyor.
        self.mudur_isi = WorkflowInstance.objects.create(
            definition=self.definition,
            subject='Müdürde bekleyen iş',
            current_step=self.step_inceleme,
            status=WorkflowInstance.Status.ACTIVE,
        )

    def _liste_konulari(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get('/api/instances/')
        self.assertEqual(response.status_code, 200)
        return [i['subject'] for i in response.data]

    def test_kullanici_yalnizca_kendi_grubunun_islerini_gorur(self):
        konular = self._liste_konulari(self.user_evrak)
        self.assertEqual(konular, ['Test başvurusu'])

    def test_baska_gruba_ait_is_listede_gorunmez(self):
        self.assertNotIn('Müdürde bekleyen iş', self._liste_konulari(self.user_evrak))
        self.assertNotIn('Test başvurusu', self._liste_konulari(self.user_mudur))

    def test_her_grup_kendi_isini_gorur(self):
        self.assertEqual(self._liste_konulari(self.user_mudur), ['Müdürde bekleyen iş'])

    def test_superuser_tum_isleri_gorur(self):
        konular = self._liste_konulari(self.admin)
        self.assertCountEqual(konular, ['Test başvurusu', 'Müdürde bekleyen iş'])

    def test_hicbir_gruba_uye_olmayan_kullanici_bos_liste_gorur(self):
        self.assertEqual(self._liste_konulari(self.user_bagimsiz), [])

    def test_sorumlu_grubu_olmayan_adimdaki_is_gruplara_gorunmez(self):
        """Bilinen sınırlama — bilinçli olarak böyle, kapsam onayı bekliyor.

        Bitiş adımının sorumlu grubu olmadığı için tamamlanan iş hiçbir grubun
        listesinde kalmaz; yalnızca yönetici görür. "Geçmişte işlem yaptığım işler
        listemde kalsın" kuralı eklendiğinde bu test güncellenecek.
        """
        self.instance.current_step = self.step_sonuc  # responsible_group=None
        self.instance.status = WorkflowInstance.Status.COMPLETED
        self.instance.save()

        self.assertNotIn('Test başvurusu', self._liste_konulari(self.user_evrak))
        self.assertIn('Test başvurusu', self._liste_konulari(self.admin))

    def test_detay_ucu_filtreden_etkilenmez(self):
        """Filtre yalnızca listede; detay, yetkisiz kullanıcıya da açık.

        2.2 ekranı "bu adımda işlem yapma yetkiniz yok" uyarısını gösterebilmek için
        işi yükleyebilmeli. Aksiyon yetkisi ayrıca serviste doğrulanıyor.
        """
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get(f'/api/instances/{self.mudur_isi.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['can_perform_action'])
        self.assertEqual(response.data['responsible_group'], 'Müdür')

    def test_islem_gecmisi_ucu_filtreden_etkilenmez(self):
        perform_transition(self.mudur_isi, self.t_iade, self.user_mudur)
        self.client.force_authenticate(user=self.user_evrak)
        response = self.client.get(f'/api/instances/{self.mudur_isi.pk}/actions/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


class LoginThrottleTests(TestCase):
    """Giriş ucundaki şifre deneme sınırı (core.views).

    Sayaç önbellekte tutulduğu ve önbellek testler arasında paylaşıldığı için
    her testin başında ve sonunda temizlenir — aksi halde bir testin doldurduğu
    kova diğerini etkiler.
    """

    LOGIN_URL = '/api/token/'
    # settings.DEFAULT_THROTTLE_RATES ile aynı olmalı.
    USERNAME_LIMIT = 5
    IP_LIMIT = 20

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user('kilit_user', password='dogru-sifre-123')

    def tearDown(self):
        cache.clear()

    def _login(self, username='kilit_user', password='yanlis-sifre'):
        return self.client.post(
            self.LOGIN_URL, {'username': username, 'password': password}, format='json'
        )

    def test_dogru_giris_normal_sartlarda_token_doner(self):
        """Sınır, meşru girişi engellememeli."""
        response = self._login(password='dogru-sifre-123')
        self.assertEqual(response.status_code, 200)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_ardarda_yanlis_sifre_denemesi_429_ile_engellenir(self):
        for deneme in range(self.USERNAME_LIMIT):
            response = self._login()
            self.assertEqual(
                response.status_code, 401, f'{deneme + 1}. deneme sınıra girmemeli'
            )
        # Sınırı aşan deneme artık doğrulamaya bile ulaşmaz.
        response = self._login()
        self.assertEqual(response.status_code, 429)

    def test_sinir_dolduktan_sonra_dogru_sifre_de_engellenir(self):
        """Saldırının anlamsız hale gelmesini sağlayan asıl özellik.

        Sınır kontrolü kimlik doğrulamasından önce çalıştığı için, saldırgan
        doğru şifreyi bulsa bile kova doluyken giriş yapamaz.
        """
        for _ in range(self.USERNAME_LIMIT):
            self._login()
        response = self._login(password='dogru-sifre-123')
        self.assertEqual(response.status_code, 429)

    def test_her_kullanici_adinin_kendi_sayaci_vardir(self):
        """Bir hesabın kilitlenmesi başka hesapların girişini engellememeli."""
        User.objects.create_user('ikinci_user', password='dogru-sifre-456')
        for _ in range(self.USERNAME_LIMIT + 1):
            self._login()  # kilit_user'ın kovasını doldur
        self.assertEqual(self._login().status_code, 429)

        response = self._login(username='ikinci_user', password='dogru-sifre-456')
        self.assertEqual(response.status_code, 200)

    def test_ip_siniri_farkli_kullanici_adlarina_yayilan_denemeyi_durdurur(self):
        """Kullanıcı adı başına sınırın kaçırdığı senaryo: her denemede farklı ad.

        Her kullanıcı adı kendi kovasında 1 denemede kalır, dolayısıyla yalnızca
        IP sınırı devreye girer.
        """
        for i in range(self.IP_LIMIT):
            response = self._login(username=f'yok_{i}')
            self.assertEqual(
                response.status_code, 401, f'{i + 1}. deneme IP sınırına girmemeli'
            )
        response = self._login(username='yok_son')
        self.assertEqual(response.status_code, 429)
