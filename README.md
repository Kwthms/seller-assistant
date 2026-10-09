# Satıcı Görevleri

Amazon Kanada/Meksika günlük görev listesi, iPhone ana ekranına eklenen web uygulaması olarak.

- Uygulama: GitHub Pages üzerinden açılır; tikler ve görevler yalnızca telefonun kendi hafızasında (IndexedDB) durur.
- Bildirimler: `.github/workflows/remind.yml` her gün 10:15, 22:59 (+20 dk tekrar) Türkiye saatinde telefona "hatırlatma zamanı" sinyali yollar. Hangi görevlerin açık olduğuna telefon kendisi bakar; hepsi bittiyse bildirim göstermez.
- Gerekli ayar: depo gizli anahtarı `VAPID_PRIVATE`, telefonun bağlantı kodu `subscriptions.json` içinde.
