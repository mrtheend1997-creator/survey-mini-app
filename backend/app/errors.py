"""API errors carry a stable `code`; the frontend shows a translated message for it.

Each message is (Uzbek new Latin "uz", Uzbek Cyrillic "oz", Russian "ru").
"""

from fastapi import HTTPException

MESSAGES = {
    "auth_required": (
        "Avtorizatsiya talab qilinadi",
        "Авторизация талаб қилинади",
        "Требуется авторизация",
    ),
    "auth_invalid": (
        "Telegram ma’lumotlari tasdiqlanmadi",
        "Telegram маълумотлари тасдиқланмади",
        "Не удалось проверить данные Telegram",
    ),
    "auth_expired": (
        "Sessiya muddati tugadi. Ilovani qayta oçing",
        "Сессия муддати тугади. Иловани қайта очинг",
        "Сессия истекла. Откройте приложение заново",
    ),
    "user_blocked": (
        "Hisobingiz bloklangan",
        "Ҳисобингиз блокланган",
        "Ваш аккаунт заблокирован",
    ),
    "forbidden": (
        "Bu amal uçun ruxsat yöq",
        "Бу амал учун рухсат йўқ",
        "Недостаточно прав для этого действия",
    ),
    "not_found": (
        "Topilmadi",
        "Топилмади",
        "Не найдено",
    ),
    "survey_not_available": (
        "Sörovnoma hozir mavjud emas",
        "Сўровнома ҳозир мавжуд эмас",
        "Опрос сейчас недоступен",
    ),
    "already_completed": (
        "Siz bu sörovnomada allaqaçon qatnaşgansiz",
        "Сиз бу сўровномада аллақачон қатнашгансиз",
        "Вы уже прошли этот опрос",
    ),
    "response_completed": (
        "Javoblar allaqaçon yuborilgan",
        "Жавоблар аллақачон юборилган",
        "Ответы уже отправлены",
    ),
    "required_missing": (
        "Majburiy savollarga javob bering",
        "Мажбурий саволларга жавоб беринг",
        "Ответьте на обязательные вопросы",
    ),
    "invalid_answer": (
        "Javob notöğri kiritilgan",
        "Жавоб нотўғри киритилган",
        "Ответ указан некорректно",
    ),
    "registration_required": (
        "Ism va telefon raqamini kiriting",
        "Исм ва телефон рақамини киритинг",
        "Укажите имя и номер телефона",
    ),
    "no_questions": (
        "Sörovnomada savollar yöq",
        "Сўровномада саволлар йўқ",
        "В опросе нет вопросов",
    ),
    "options_required": (
        "Kamida 2 ta javob varianti kerak",
        "Камида 2 та жавоб варианти керак",
        "Нужно минимум 2 варианта ответа",
    ),
    "title_required": (
        "Kamida bitta tilda nomini kiriting",
        "Камида битта тилда номини киритинг",
        "Укажите название хотя бы на одном языке",
    ),
    "question_text_required": (
        "Savol matnini kamida bitta tilda kiriting",
        "Савол матнини камида битта тилда киритинг",
        "Введите текст вопроса хотя бы на одном языке",
    ),
    "option_text_required": (
        "Har bir variant matnini kamida bitta tilda kiriting",
        "Ҳар бир вариант матнини камида битта тилда киритинг",
        "Заполните текст каждого варианта хотя бы на одном языке",
    ),
    "invalid_dates": (
        "Tugaş sanasi boşlaniş sanasidan oldin bölişi mumkin emas",
        "Тугаш санаси бошланиш санасидан олдин бўлиши мумкин эмас",
        "Дата завершения не может быть раньше даты начала",
    ),
    "invalid_choice_limits": (
        "Tanlovlar soni çegarasi notöğri",
        "Танловлар сони чегараси нотўғри",
        "Неверные ограничения количества выбранных вариантов",
    ),
    "role_not_allowed": (
        "Bu rolni tayinlay olmaysiz",
        "Бу ролни тайинлай олмайсиз",
        "Вы не можете назначить эту роль",
    ),
    "cannot_change_self": (
        "Öz rolingiz va huquqlaringizni özgartira olmaysiz",
        "Ўз ролингиз ва ҳуқуқларингизни ўзгартира олмайсиз",
        "Нельзя изменять собственную роль и права",
    ),
    "last_super_admin": (
        "Kamida bitta faol Super Admin qolişi kerak",
        "Камида битта фаол Super Admin қолиши керак",
        "Должен остаться хотя бы один действующий Super Admin",
    ),
    "env_super_admin": (
        "Bu Super Admin server sozlamalarida (SUPER_ADMIN_TELEGRAM_IDS) belgilangan, uni faqat öşa yerda özgartiriş mumkin",
        "Бу Super Admin сервер созламаларида (SUPER_ADMIN_TELEGRAM_IDS) белгиланган, уни фақат ўша ерда ўзгартириш мумкин",
        "Этот Super Admin задан в настройках сервера (SUPER_ADMIN_TELEGRAM_IDS) и меняется только там",
    ),
    "already_admin": (
        "Bu foydalanuvçi allaqaçon administrator. Uni röyxatda tahrirlang",
        "Бу фойдаланувчи аллақачон администратор. Уни рўйхатда таҳрирланг",
        "Этот пользователь уже администратор. Измените его в списке",
    ),
    "invalid_telegram_id": (
        "Telegram ID notöğri. Faqat raqamlarni kiriting",
        "Telegram ID нотўғри. Фақат рақамларни киритинг",
        "Неверный Telegram ID. Введите только цифры",
    ),
    "no_publish_right": (
        "Sizda sörovnomalarni e’lon qiliş huquqi yöq",
        "Сизда сўровномаларни эълон қилиш ҳуқуқи йўқ",
        "У вас нет права публиковать опросы",
    ),
    "invalid_import": (
        "Import fayli notöğri tuzilgan",
        "Импорт файли нотўғри тузилган",
        "Файл импорта составлен неверно",
    ),
    "invalid_logic": (
        "Ötiş şartlari notöğri töldirilgan",
        "Ўтиш шартлари нотўғри тўлдирилган",
        "Переходы между вопросами заполнены неверно",
    ),
    "logic_missing_option": (
        "Ötiş şarti öçirilgan javob variantiga boğlangan",
        "Ўтиш шарти ўчирилган жавоб вариантига боғланган",
        "Переход привязан к удалённому варианту ответа",
    ),
    "logic_multi_choice": (
        "Bir neçta javobli savolda variant böyiça ötiş qöyib bölmaydi",
        "Бир нечта жавобли саволда вариант бўйича ўтиш қўйиб бўлмайди",
        "В вопросе с несколькими ответами нельзя задать переход по варианту",
    ),
    "logic_wrong_type": (
        "Bu turdagi savolda javobga qarab ötiş qöyib bölmaydi",
        "Бу турдаги саволда жавобга қараб ўтиш қўйиб бўлмайди",
        "В вопросе этого типа нельзя задать переход по ответу",
    ),
    "logic_missing_target": (
        "Ötiş öçirilgan yoki yaşirilgan savolga körsatilgan",
        "Ўтиш ўчирилган ёки яширилган саволга кўрсатилган",
        "Переход ведёт к удалённому или скрытому вопросу",
    ),
    "logic_backward": (
        "Ötiş faqat keyingi savollarga bölişi mumkin (aks holda sörov aylanib qoladi)",
        "Ўтиш фақат кейинги саволларга бўлиши мумкин (акс ҳолда сўров айланиб қолади)",
        "Переход возможен только к последующим вопросам (иначе опрос зациклится)",
    ),
    "invalid_welcome": (
        "Xuş kelibsiz xabari notöğri töldirilgan",
        "Хуш келибсиз хабари нотўғри тўлдирилган",
        "Приветственное сообщение заполнено неверно",
    ),
    "bot_not_configured": (
        "Bot tokeni sozlanmagan",
        "Бот токени созланмаган",
        "Токен бота не настроен",
    ),
    "bot_send_failed": (
        "Telegram xabarni qabul qilmadi. Botga /start yuboring va qayta urinib köring",
        "Telegram хабарни қабул қилмади. Ботга /start юборинг ва қайта уриниб кўринг",
        "Telegram не принял сообщение. Отправьте боту /start и попробуйте ещё раз",
    ),
    "no_permission": (
        "Bu amal uçun sizda ruxsat yöq",
        "Бу амал учун сизда рухсат йўқ",
        "У вас нет права на это действие",
    ),
    "no_export_right": (
        "Sizda ma’lumotlarni yuklab oliş huquqi yöq",
        "Сизда маълумотларни юклаб олиш ҳуқуқи йўқ",
        "У вас нет права выгружать данные",
    ),
    "file_too_large": (
        "Fayl juda katta",
        "Файл жуда катта",
        "Файл слишком большой",
    ),
    "file_type": (
        "Bu formatdagi faylni yuklab bölmaydi. Rasm tanlang (PNG, JPG, WEBP)",
        "Бу форматдаги файлни юклаб бўлмайди. Расм танланг (PNG, JPG, WEBP)",
        "Этот формат не поддерживается. Выберите изображение (PNG, JPG, WEBP)",
    ),
    "invalid_settings": (
        "Savol sozlamalari notöğri",
        "Савол созламалари нотўғри",
        "Неверные настройки вопроса",
    ),
    "row_text_required": (
        "Jadvalning har bir qatori matnini kamida bitta tilda kiriting",
        "Жадвалнинг ҳар бир қатори матнини камида битта тилда киритинг",
        "Заполните текст каждой строки таблицы хотя бы на одном языке",
    ),
    "contact_purpose_required": (
        "Ma’lumotlar nima uçun söralayotganini yozing",
        "Маълумотлар нима учун сўралаётганини ёзинг",
        "Укажите, для чего собираются контактные данные",
    ),
    "too_many_options": (
        "Juft taqqoslaşda köpi bilan 6 ta variant bölişi mumkin",
        "Жуфт таққослашда кўпи билан 6 та вариант бўлиши мумкин",
        "В попарном сравнении можно не больше 6 вариантов",
    ),
    "personal_in_anonymous": (
        "Anonim sörovnomada kontakt ma’lumotlarini sörab bölmaydi. Sörovnoma turini özgartiring yoki savolni öçiring",
        "Аноним сўровномада контакт маълумотларини сўраб бўлмайди. Сўровнома турини ўзгартиринг ёки саволни ўчиринг",
        "В анонимном опросе нельзя запрашивать контактные данные. Измените тип опроса или удалите вопрос",
    ),
    "file_format": (
        "Bu formatdagi fayl qabul qilinmaydi",
        "Бу форматдаги файл қабул қилинмайди",
        "Файл этого формата не принимается",
    ),
    "too_many_files": (
        "Fayllar soni çegaradan oşdi",
        "Файллар сони чегарадан ошди",
        "Превышено количество файлов",
    ),
    "invalid_video": (
        "Video havolasi notöğri (https://... kerak)",
        "Видео ҳаволаси нотўғри (https://... керак)",
        "Неверная ссылка на видео (нужна https://...)",
    ),
    "edit_needs_named": (
        "Javoblarni özgartiriş faqat nomli sörovnomalarda mumkin",
        "Жавобларни ўзгартириш фақат номли сўровномаларда мумкин",
        "Изменять ответы после отправки можно только в именных опросах",
    ),
    "time_over": (
        "Vaqt tugadi",
        "Вақт тугади",
        "Время вышло",
    ),
    "question_time_over": (
        "Bu savol uçun vaqt tugadi",
        "Бу савол учун вақт тугади",
        "Время на этот вопрос истекло",
    ),
    "attempts_used": (
        "Barça urinişlardan foydalanildi",
        "Барча уринишлардан фойдаланилди",
        "Все попытки использованы",
    ),
    "attempts_locked": (
        "Vaqt tugaganligi sababli qayta qatnaşib bölmaydi",
        "Вақт тугаганлиги сабабли қайта қатнашиб бўлмайди",
        "Повторное участие недоступно: время прошлой попытки истекло",
    ),
    "edit_not_allowed": (
        "Javoblarni özgartirib bölmaydi",
        "Жавобларни ўзгартириб бўлмайди",
        "Изменить ответы нельзя",
    ),
    "not_published": (
        "Sörovnoma hali e’lon qilinmagan",
        "Сўровнома ҳали эълон қилинмаган",
        "Опрос ещё не опубликован",
    ),
}


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, extra: dict | None = None):
        uz, oz, ru = MESSAGES.get(code, (code, code, code))
        detail = {"code": code, "message_uz": uz, "message_oz": oz, "message_ru": ru}
        if extra:
            detail.update(extra)
        super().__init__(status_code=status_code, detail=detail)
