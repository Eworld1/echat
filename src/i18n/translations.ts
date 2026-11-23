/**
 * UI text for every supported language. English is the master list; any key missing from another
 * language falls back to English. Krio and Arabic should be reviewed by native speakers before launch.
 */
export const en = {
  search_placeholder: 'Search friends, posts, pages...',
  notifications: 'Notifications',
  mark_all_read: 'Mark all read',
  no_notifications: 'No notifications yet',
  call_back: 'Call back',
  open_chat: 'Open chat',
  see_profile: 'See your profile',
  install_app: 'Install app',
  developer_admin: 'Developer Mode & Admin',
  log_out: 'Log Out',
  news_feed: 'News Feed',
  friends_requests: 'Friends & Requests',
  pages: 'Pages',
  groups: 'Groups',
  events: 'Events',
  settings_privacy: 'Settings & Privacy',
  saved_posts: 'Saved Posts',
  your_shortcuts: 'Your Shortcuts',
  like: 'Like',
  comment: 'Comment',
  share: 'Share',
  reply: 'Reply',
  copy_link: 'Copy Link to Post',
  report_post: 'Report Post',
  edit_post: 'Edit Post',
  delete_post: 'Delete Post',
  save_post: 'Save post',
  unsave_post: 'Unsave post',
  delete_confirm_title: 'Delete this post?',
  cancel: 'Cancel',
  delete: 'Delete',
  write_comment: 'Write a comment...',
  be_first_react: 'Be the first to react',
  go_live: 'Go Live',
  photo_video: 'Photo/video',
  feeling_activity: 'Feeling/activity',
  create_story: 'Create story',
  loading_feed: 'Loading News Feed...',
  no_posts: 'No posts in feed yet',
  no_posts_hint: 'Be the first to share an update with your friends!',
  friends: 'Friends',
  confirm_request: 'Confirm Request',
  delete_request: 'Delete Request',
  add_friend: 'Add Friend',
  request_sent: 'Request Sent',
  search_friends: 'Search friends...',
  no_pending_requests: 'No pending friend requests',
  no_friends_yet: 'You have no friends yet',
  no_suggestions: 'No friend suggestions right now',
  trending: 'Trending',
  create_post: 'Create post',
  add_to_post: 'Add to your post',
  post: 'Post',
  posting: 'Posting...',
  composer_mind: "What's on your mind, {name}?",
  general_preferences: 'General Preferences',
  appearance_theme: 'Appearance & Theme',
  light_theme: 'Light Theme',
  light_theme_hint: 'Classic bright look',
  dark_theme: 'Dark Theme',
  dark_theme_hint: 'Easy on the eyes',
  system_theme: 'Device setting',
  system_theme_hint: 'Match my phone or computer',
  language: 'Language',
  notifications_audio: 'Notifications & Audio',
  saved_nothing: 'Nothing saved yet',
  try_again: 'Try again'
};

export type TranslationKey = keyof typeof en;
type Dictionary = Partial<Record<TranslationKey, string>>;

const fr: Dictionary = {
  search_placeholder: 'Rechercher des amis, publications, pages...', notifications: 'Notifications', mark_all_read: 'Tout marquer comme lu',
  no_notifications: 'Aucune notification', call_back: 'Rappeler', open_chat: 'Ouvrir la discussion', see_profile: 'Voir votre profil',
  install_app: "Installer l'application", developer_admin: 'Mode développeur et admin', log_out: 'Se déconnecter', news_feed: "Fil d'actualité",
  friends_requests: 'Amis et demandes', pages: 'Pages', groups: 'Groupes', events: 'Événements', settings_privacy: 'Paramètres et confidentialité',
  saved_posts: 'Publications enregistrées', your_shortcuts: 'Vos raccourcis', like: "J'aime", comment: 'Commenter', share: 'Partager', reply: 'Répondre',
  copy_link: 'Copier le lien', report_post: 'Signaler la publication', edit_post: 'Modifier la publication', delete_post: 'Supprimer la publication',
  save_post: 'Enregistrer', unsave_post: 'Retirer des enregistrements', delete_confirm_title: 'Supprimer cette publication ?', cancel: 'Annuler', delete: 'Supprimer',
  write_comment: 'Écrire un commentaire...', be_first_react: 'Soyez le premier à réagir', go_live: 'Passer en direct', photo_video: 'Photo/vidéo',
  feeling_activity: 'Humeur/activité', create_story: 'Créer une story', loading_feed: "Chargement du fil d'actualité...", no_posts: "Aucune publication pour l'instant",
  no_posts_hint: 'Soyez le premier à partager une actualité avec vos amis !', friends: 'Amis', confirm_request: 'Confirmer', delete_request: 'Supprimer la demande',
  add_friend: 'Ajouter', request_sent: 'Demande envoyée', search_friends: 'Rechercher des amis...', no_pending_requests: "Aucune demande d'ami en attente",
  no_friends_yet: "Vous n'avez pas encore d'amis", no_suggestions: "Aucune suggestion d'ami pour le moment", trending: 'Tendances', create_post: 'Créer une publication',
  add_to_post: 'Ajouter à votre publication', post: 'Publier', posting: 'Publication...', composer_mind: 'Quoi de neuf, {name} ?',
  general_preferences: 'Préférences générales', appearance_theme: 'Apparence et thème', light_theme: 'Thème clair', light_theme_hint: 'Look lumineux classique',
  dark_theme: 'Thème sombre', dark_theme_hint: 'Reposant pour les yeux', system_theme: "Réglage de l'appareil", system_theme_hint: 'Suivre mon téléphone ou ordinateur',
  language: 'Langue', notifications_audio: 'Notifications et audio', saved_nothing: 'Rien d\'enregistré', try_again: 'Réessayer'
};

const es: Dictionary = {
  search_placeholder: 'Buscar amigos, publicaciones, páginas...', notifications: 'Notificaciones', mark_all_read: 'Marcar todo como leído',
  no_notifications: 'Aún no hay notificaciones', call_back: 'Devolver llamada', open_chat: 'Abrir chat', see_profile: 'Ver tu perfil',
  install_app: 'Instalar la app', developer_admin: 'Modo desarrollador y admin', log_out: 'Cerrar sesión', news_feed: 'Noticias',
  friends_requests: 'Amigos y solicitudes', pages: 'Páginas', groups: 'Grupos', events: 'Eventos', settings_privacy: 'Configuración y privacidad',
  saved_posts: 'Publicaciones guardadas', your_shortcuts: 'Tus accesos directos', like: 'Me gusta', comment: 'Comentar', share: 'Compartir', reply: 'Responder',
  copy_link: 'Copiar enlace', report_post: 'Denunciar publicación', edit_post: 'Editar publicación', delete_post: 'Eliminar publicación',
  save_post: 'Guardar publicación', unsave_post: 'Quitar de guardados', delete_confirm_title: '¿Eliminar esta publicación?', cancel: 'Cancelar', delete: 'Eliminar',
  write_comment: 'Escribe un comentario...', be_first_react: 'Sé el primero en reaccionar', go_live: 'En vivo', photo_video: 'Foto/video',
  feeling_activity: 'Sentimiento/actividad', create_story: 'Crear historia', loading_feed: 'Cargando noticias...', no_posts: 'Aún no hay publicaciones',
  no_posts_hint: '¡Sé el primero en compartir algo con tus amigos!', friends: 'Amigos', confirm_request: 'Confirmar', delete_request: 'Eliminar solicitud',
  add_friend: 'Añadir amigo', request_sent: 'Solicitud enviada', search_friends: 'Buscar amigos...', no_pending_requests: 'No hay solicitudes pendientes',
  no_friends_yet: 'Aún no tienes amigos', no_suggestions: 'No hay sugerencias por ahora', trending: 'Tendencias', create_post: 'Crear publicación',
  add_to_post: 'Añadir a tu publicación', post: 'Publicar', posting: 'Publicando...', composer_mind: '¿Qué estás pensando, {name}?',
  general_preferences: 'Preferencias generales', appearance_theme: 'Apariencia y tema', light_theme: 'Tema claro', light_theme_hint: 'Aspecto luminoso clásico',
  dark_theme: 'Tema oscuro', dark_theme_hint: 'Descansa la vista', system_theme: 'Ajuste del dispositivo', system_theme_hint: 'Igual que mi teléfono u ordenador',
  language: 'Idioma', notifications_audio: 'Notificaciones y audio', saved_nothing: 'Nada guardado aún', try_again: 'Reintentar'
};

const de: Dictionary = {
  search_placeholder: 'Freunde, Beiträge, Seiten suchen...', notifications: 'Benachrichtigungen', mark_all_read: 'Alle als gelesen markieren',
  no_notifications: 'Noch keine Benachrichtigungen', call_back: 'Zurückrufen', open_chat: 'Chat öffnen', see_profile: 'Dein Profil ansehen',
  install_app: 'App installieren', developer_admin: 'Entwicklermodus & Admin', log_out: 'Abmelden', news_feed: 'Neuigkeiten',
  friends_requests: 'Freunde & Anfragen', pages: 'Seiten', groups: 'Gruppen', events: 'Veranstaltungen', settings_privacy: 'Einstellungen & Datenschutz',
  saved_posts: 'Gespeicherte Beiträge', your_shortcuts: 'Deine Verknüpfungen', like: 'Gefällt mir', comment: 'Kommentieren', share: 'Teilen', reply: 'Antworten',
  copy_link: 'Link kopieren', report_post: 'Beitrag melden', edit_post: 'Beitrag bearbeiten', delete_post: 'Beitrag löschen',
  save_post: 'Beitrag speichern', unsave_post: 'Nicht mehr speichern', delete_confirm_title: 'Diesen Beitrag löschen?', cancel: 'Abbrechen', delete: 'Löschen',
  write_comment: 'Kommentar schreiben...', be_first_react: 'Sei der Erste, der reagiert', go_live: 'Live gehen', photo_video: 'Foto/Video',
  feeling_activity: 'Gefühl/Aktivität', create_story: 'Story erstellen', loading_feed: 'Neuigkeiten werden geladen...', no_posts: 'Noch keine Beiträge',
  no_posts_hint: 'Teile als Erster etwas mit deinen Freunden!', friends: 'Freunde', confirm_request: 'Bestätigen', delete_request: 'Anfrage löschen',
  add_friend: 'Hinzufügen', request_sent: 'Anfrage gesendet', search_friends: 'Freunde suchen...', no_pending_requests: 'Keine offenen Anfragen',
  no_friends_yet: 'Du hast noch keine Freunde', no_suggestions: 'Gerade keine Vorschläge', trending: 'Im Trend', create_post: 'Beitrag erstellen',
  add_to_post: 'Zu deinem Beitrag hinzufügen', post: 'Posten', posting: 'Wird gepostet...', composer_mind: 'Was machst du gerade, {name}?',
  general_preferences: 'Allgemeine Einstellungen', appearance_theme: 'Darstellung & Design', light_theme: 'Helles Design', light_theme_hint: 'Klassisch hell',
  dark_theme: 'Dunkles Design', dark_theme_hint: 'Schonend für die Augen', system_theme: 'Geräteeinstellung', system_theme_hint: 'Wie mein Handy oder Computer',
  language: 'Sprache', notifications_audio: 'Benachrichtigungen & Ton', saved_nothing: 'Noch nichts gespeichert', try_again: 'Erneut versuchen'
};

const ar: Dictionary = {
  search_placeholder: 'ابحث عن أصدقاء ومنشورات وصفحات...', notifications: 'الإشعارات', mark_all_read: 'تحديد الكل كمقروء',
  no_notifications: 'لا توجد إشعارات بعد', call_back: 'اتصل مجددًا', open_chat: 'افتح المحادثة', see_profile: 'عرض ملفك الشخصي',
  install_app: 'تثبيت التطبيق', developer_admin: 'وضع المطوّر والإدارة', log_out: 'تسجيل الخروج', news_feed: 'آخر الأخبار',
  friends_requests: 'الأصدقاء والطلبات', pages: 'الصفحات', groups: 'المجموعات', events: 'الفعاليات', settings_privacy: 'الإعدادات والخصوصية',
  saved_posts: 'المنشورات المحفوظة', your_shortcuts: 'اختصاراتك', like: 'إعجاب', comment: 'تعليق', share: 'مشاركة', reply: 'رد',
  copy_link: 'نسخ رابط المنشور', report_post: 'الإبلاغ عن المنشور', edit_post: 'تعديل المنشور', delete_post: 'حذف المنشور',
  save_post: 'حفظ المنشور', unsave_post: 'إزالة من المحفوظات', delete_confirm_title: 'حذف هذا المنشور؟', cancel: 'إلغاء', delete: 'حذف',
  write_comment: 'اكتب تعليقًا...', be_first_react: 'كن أول من يتفاعل', go_live: 'بث مباشر', photo_video: 'صورة/فيديو',
  feeling_activity: 'شعور/نشاط', create_story: 'إنشاء قصة', loading_feed: 'جارٍ تحميل الأخبار...', no_posts: 'لا توجد منشورات بعد',
  no_posts_hint: 'كن أول من يشارك تحديثًا مع أصدقائه!', friends: 'الأصدقاء', confirm_request: 'تأكيد الطلب', delete_request: 'حذف الطلب',
  add_friend: 'إضافة صديق', request_sent: 'تم إرسال الطلب', search_friends: 'ابحث عن الأصدقاء...', no_pending_requests: 'لا توجد طلبات صداقة معلّقة',
  no_friends_yet: 'ليس لديك أصدقاء بعد', no_suggestions: 'لا توجد اقتراحات حاليًا', trending: 'الأكثر رواجًا', create_post: 'إنشاء منشور',
  add_to_post: 'أضف إلى منشورك', post: 'نشر', posting: 'جارٍ النشر...', composer_mind: 'بماذا تفكر يا {name}؟',
  general_preferences: 'التفضيلات العامة', appearance_theme: 'المظهر والسمة', light_theme: 'السمة الفاتحة', light_theme_hint: 'مظهر ساطع كلاسيكي',
  dark_theme: 'السمة الداكنة', dark_theme_hint: 'مريحة للعينين', system_theme: 'إعداد الجهاز', system_theme_hint: 'مثل هاتفي أو حاسوبي',
  language: 'اللغة', notifications_audio: 'الإشعارات والصوت', saved_nothing: 'لا شيء محفوظ بعد', try_again: 'حاول مرة أخرى'
};

const kri: Dictionary = {
  search_placeholder: 'Luk fɔ padi dɛn, pos dɛn, peg dɛn...', notifications: 'Nɔtifikeshɔn dɛn', mark_all_read: 'Mak ɔl as rid',
  no_notifications: 'No nɔtifikeshɔn yet', call_back: 'Kɔl am bak', open_chat: 'Opin chat', see_profile: 'Si yu prɔfayl',
  install_app: 'Instɔl di app', developer_admin: 'Divɛlɔpa & Admin', log_out: 'Lɔg Awt', news_feed: 'Nyuz Fid',
  friends_requests: 'Padi dɛn & Rikwɛst', pages: 'Peg dɛn', groups: 'Grup dɛn', events: 'Ivɛnt dɛn', settings_privacy: 'Setin & Praivasi',
  saved_posts: 'Pos dɛn we yu seiv', your_shortcuts: 'Yu shɔtkɔt dɛn', like: 'Lɛk', comment: 'Kɔmɛnt', share: 'Shɛr', reply: 'Ansa',
  copy_link: 'Kɔpi di pos lɛnk', report_post: 'Ripɔt di pos', edit_post: 'Chenj di pos', delete_post: 'Dilit di pos',
  save_post: 'Seiv di pos', unsave_post: 'Pul am na seiv', delete_confirm_title: 'Yu want dilit dis pos?', cancel: 'Kansul', delete: 'Dilit',
  write_comment: 'Rayt kɔmɛnt...', be_first_react: 'Bi di fɔs pɔsin fɔ rɛspɔnd', go_live: 'Go Layv', photo_video: 'Foto/vidio',
  feeling_activity: 'Fiilin/wetin yu de du', create_story: 'Mek stori', loading_feed: 'Nyuz de lod...', no_posts: 'No pos yet',
  no_posts_hint: 'Bi di fɔs wan fɔ shɛr wan nyuz wit yu padi dɛn!', friends: 'Padi dɛn', confirm_request: 'Kɔnfɔm', delete_request: 'Dilit rikwɛst',
  add_friend: 'Ad padi', request_sent: 'Rikwɛst dɔn sɛn', search_friends: 'Luk fɔ padi dɛn...', no_pending_requests: 'No rikwɛst de wet',
  no_friends_yet: 'Yu nɔ gɛt padi yet', no_suggestions: 'No sɔgɛshɔn naw', trending: 'Wetin pipul de tɔk', create_post: 'Mek pos',
  add_to_post: 'Ad to yu pos', post: 'Pos', posting: 'De pos...', composer_mind: 'Wetin de na yu maynd, {name}?',
  general_preferences: 'Jɛnɛral Setin dɛn', appearance_theme: 'Lɔk & Tim', light_theme: 'Layt Tim', light_theme_hint: 'Di klasik layt lɔk',
  dark_theme: 'Dak Tim', dark_theme_hint: 'Isi fɔ yu yay', system_theme: 'Divays setin', system_theme_hint: 'Sem as mi fon ɔ kɔmpyuta',
  language: 'Langwej', notifications_audio: 'Nɔtifikeshɔn & Saund', saved_nothing: 'Nɔtin nɔ de seiv yet', try_again: 'Tray igen'
};

export const LANGUAGES = {
  English: { label: 'English (United States)', code: 'en', dir: 'ltr', dict: en as Dictionary },
  Krio: { label: 'Krio (Sierra Leone)', code: 'kri', dir: 'ltr', dict: kri },
  French: { label: 'Français (French)', code: 'fr', dir: 'ltr', dict: fr },
  Spanish: { label: 'Español (Spanish)', code: 'es', dir: 'ltr', dict: es },
  Arabic: { label: 'العربية (Arabic)', code: 'ar', dir: 'rtl', dict: ar },
  German: { label: 'Deutsch (German)', code: 'de', dir: 'ltr', dict: de }
} as const;

export type LanguageName = keyof typeof LANGUAGES;
export const isLanguageName = (v: string | null): v is LanguageName => !!v && v in LANGUAGES;
