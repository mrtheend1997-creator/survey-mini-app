"""API errors carry a stable `code`; the frontend shows a translated (uz/ru) message for it."""

from fastapi import HTTPException

MESSAGES = {
    "auth_required": ("Avtorizatsiya talab qilinadi", "Требуется авторизация"),
    "auth_invalid": ("Telegram ma'lumotlari tasdiqlanmadi", "Не удалось проверить данные Telegram"),
    "auth_expired": ("Sessiya muddati tugadi. Ilovani qayta oching", "Сессия истекла. Откройте приложение заново"),
    "user_blocked": ("Hisobingiz bloklangan", "Ваш аккаунт заблокирован"),
    "forbidden": ("Bu amal uchun ruxsat yo'q", "Недостаточно прав для этого действия"),
    "not_found": ("Topilmadi", "Не найдено"),
    "survey_not_available": ("So'rovnoma hozir mavjud emas", "Опрос сейчас недоступен"),
    "already_completed": ("Siz bu so'rovnomada allaqachon qatnashgansiz", "Вы уже прошли этот опрос"),
    "response_completed": ("Javoblar allaqachon yuborilgan", "Ответы уже отправлены"),
    "required_missing": ("Majburiy savollarga javob bering", "Ответьте на обязательные вопросы"),
    "invalid_answer": ("Javob noto'g'ri kiritilgan", "Ответ указан некорректно"),
    "registration_required": ("Ism va telefon raqamini kiriting", "Укажите имя и номер телефона"),
    "no_questions": ("So'rovnomada savollar yo'q", "В опросе нет вопросов"),
    "options_required": ("Kamida 2 ta javob varianti kerak", "Нужно минимум 2 варианта ответа"),
    "title_required": ("Ikkala tilda ham nomini kiriting", "Укажите название на обоих языках"),
    "question_text_required": ("Savol matnini ikkala tilda kiriting", "Введите текст вопроса на обоих языках"),
    "option_text_required": ("Har bir variant matnini ikkala tilda kiriting", "Заполните текст каждого варианта на обоих языках"),
    "invalid_dates": ("Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas", "Дата завершения не может быть раньше даты начала"),
    "invalid_choice_limits": ("Tanlovlar soni chegarasi noto'g'ri", "Неверные ограничения количества выбранных вариантов"),
    "role_not_allowed": ("Bu rolni tayinlay olmaysiz", "Вы не можете назначить эту роль"),
    "cannot_change_self": ("O'z rolingiz va huquqlaringizni o'zgartira olmaysiz", "Нельзя изменять собственную роль и права"),
    "last_super_admin": ("Kamida bitta faol Super Admin qolishi kerak", "Должен остаться хотя бы один действующий Super Admin"),
    "env_super_admin": (
        "Bu Super Admin server sozlamalarida (SUPER_ADMIN_TELEGRAM_IDS) belgilangan, uni faqat o'sha yerda o'zgartirish mumkin",
        "Этот Super Admin задан в настройках сервера (SUPER_ADMIN_TELEGRAM_IDS) и меняется только там",
    ),
    "already_admin": ("Bu foydalanuvchi allaqachon administrator. Uni ro'yxatda tahrirlang", "Этот пользователь уже администратор. Измените его в списке"),
    "invalid_telegram_id": ("Telegram ID noto'g'ri. Faqat raqamlarni kiriting", "Неверный Telegram ID. Введите только цифры"),
    "no_publish_right": ("Sizda so'rovnomalarni e'lon qilish huquqi yo'q", "У вас нет права публиковать опросы"),
    "invalid_import": ("Import fayli noto'g'ri tuzilgan", "Файл импорта составлен неверно"),
    "invalid_logic": ("O'tish shartlari noto'g'ri to'ldirilgan", "Переходы между вопросами заполнены неверно"),
    "logic_missing_option": ("O'tish sharti o'chirilgan javob variantiga bog'langan", "Переход привязан к удалённому варианту ответа"),
    "logic_multi_choice": ("Bir nechta javobli savolda variant bo'yicha o'tish qo'yib bo'lmaydi", "В вопросе с несколькими ответами нельзя задать переход по варианту"),
    "logic_wrong_type": ("Bu turdagi savolda javobga qarab o'tish qo'yib bo'lmaydi", "В вопросе этого типа нельзя задать переход по ответу"),
    "logic_missing_target": ("O'tish o'chirilgan yoki yashirilgan savolga ko'rsatilgan", "Переход ведёт к удалённому или скрытому вопросу"),
    "logic_backward": ("O'tish faqat keyingi savollarga bo'lishi mumkin (aks holda so'rov aylanib qoladi)", "Переход возможен только к последующим вопросам (иначе опрос зациклится)"),
    "invalid_welcome": ("Xush kelibsiz xabari noto'g'ri to'ldirilgan", "Приветственное сообщение заполнено неверно"),
    "bot_not_configured": ("Bot tokeni sozlanmagan", "Токен бота не настроен"),
    "bot_send_failed": ("Telegram xabarni qabul qilmadi. Botga /start yuboring va qayta urinib ko'ring", "Telegram не принял сообщение. Отправьте боту /start и попробуйте ещё раз"),
    "no_permission": ("Bu amal uchun sizda ruxsat yo'q", "У вас нет права на это действие"),
    "no_export_right": ("Sizda ma'lumotlarni yuklab olish huquqi yo'q", "У вас нет права выгружать данные"),
    "file_too_large": ("Fayl juda katta", "Файл слишком большой"),
    "file_type": ("Bu formatdagi faylni yuklab bo'lmaydi. Rasm tanlang (PNG, JPG, WEBP)", "Этот формат не поддерживается. Выберите изображение (PNG, JPG, WEBP)"),
    "invalid_settings": ("Savol sozlamalari noto'g'ri", "Неверные настройки вопроса"),
    "row_text_required": ("Jadvalning har bir qatori matnini ikkala tilda kiriting", "Заполните текст каждой строки таблицы на обоих языках"),
    "contact_purpose_required": (
        "Ma'lumotlar nima uchun so'ralayotganini ikkala tilda yozing",
        "Укажите на обоих языках, для чего собираются контактные данные",
    ),
    "too_many_options": ("Juft taqqoslashda ko'pi bilan 6 ta variant bo'lishi mumkin", "В попарном сравнении можно не больше 6 вариантов"),
    "personal_in_anonymous": (
        "Anonim so'rovnomada kontakt ma'lumotlarini so'rab bo'lmaydi. So'rovnoma turini o'zgartiring yoki savolni o'chiring",
        "В анонимном опросе нельзя запрашивать контактные данные. Измените тип опроса или удалите вопрос",
    ),
    "file_format": ("Bu formatdagi fayl qabul qilinmaydi", "Файл этого формата не принимается"),
    "too_many_files": ("Fayllar soni chegaradan oshdi", "Превышено количество файлов"),
    "invalid_video": ("Video havolasi noto'g'ri (https://... kerak)", "Неверная ссылка на видео (нужна https://...)"),
    "edit_needs_named": (
        "Javoblarni o'zgartirish faqat nomli so'rovnomalarda mumkin",
        "Изменять ответы после отправки можно только в именных опросах",
    ),
    "time_over": ("Vaqt tugadi", "Время вышло"),
    "question_time_over": ("Bu savol uchun vaqt tugadi", "Время на этот вопрос истекло"),
    "attempts_used": ("Barcha urinishlardan foydalanildi", "Все попытки использованы"),
    "attempts_locked": (
        "Vaqt tugaganligi sababli qayta qatnashib bo'lmaydi",
        "Повторное участие недоступно: время прошлой попытки истекло",
    ),
    "edit_not_allowed": ("Javoblarni o'zgartirib bo'lmaydi", "Изменить ответы нельзя"),
    "not_published": ("So'rovnoma hali e'lon qilinmagan", "Опрос ещё не опубликован"),
}


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, extra: dict | None = None):
        uz, ru = MESSAGES.get(code, (code, code))
        detail = {"code": code, "message_uz": uz, "message_ru": ru}
        if extra:
            detail.update(extra)
        super().__init__(status_code=status_code, detail=detail)
