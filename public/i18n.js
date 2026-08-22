const STORAGE_KEY = "easymarket_language";
const LANGUAGE_EVENT = "easymarket:languagechange";
const SUPPORTED_LANGUAGES = new Set(["ru", "en"]);

const EXACT_EN = new Map(Object.entries({
  "Валюта ставок": "Bet currency",
  "Кошелек": "Wallet",
  "Рынок Киевстонера": "Kyivstoner market",
  "Спорт": "Sports",
  "Меню": "Menu",
  "Открыть задания": "Open tasks",
  "Задания": "Tasks",
  "Рейтинг": "Leaderboard",
  "Кланы": "Clans",
  "Настройки": "Settings",
  "Закрыть настройки": "Close settings",
  "Язык": "Language",
  "Язык приложения": "App language",
  "Можно изменить в любой момент.": "You can change it at any time.",
  "Звук эффектов": "Effect sounds",
  "Energy-saber клики, победы и важные отклики.": "Energy-saber taps, wins and important feedback.",
  "Пульс рынка": "Market pulse",
  "Телефон стучит в такт цене, пока открыта позиция.": "Your phone pulses with the price while a position is open.",
  "Аквариум на BTC 5m": "Aquarium on BTC 5m",
  "Корм и рыбки только на 5-минутном BTC-графике.": "Food and fish only on the BTC 5-minute chart.",
  "Премиум анимация": "Premium animation",
  "Премиум-шоу вместо рыбок при встряске графика.": "Premium show instead of fish when you shake the chart.",
  "Шеринг выигрышей": "Share wins",
  "Карточка «поделиться в сторис» после победы.": "A story card after a win.",
  "Моя статистика": "My stats",
  "Закрыть задания": "Close tasks",
  "Задания и вывод недоступны, пока действует страйк.": "Tasks and withdrawals are unavailable while the strike is active.",
  "Показать задания": "Show tasks",
  "Скрыть задания": "Hide tasks",
  "Бонус за депозит": "Deposit bonus",
  "Пополнить": "Top up",
  "Шейк, шейк!": "Shake, shake!",
  "Покорми рыбок — тряси телефон на графике": "Feed the fish by shaking your phone on the chart",
  "Тряси!": "Shake!",
  "Заряд молнии": "Lightning charge",
  "Заходи каждый день — на 7-й лутбокс": "Come back daily — lootbox on day 7",
  "Время в игре сегодня": "Time in app today",
  "Бонус дня · новые в полночь": "Daily bonus · resets at midnight",
  "Основные дейлики": "Core dailies",
  "Очки конкурса": "Contest points",
  "Социальные": "Social",
  "Вступи в клан": "Join a clan",
  "Найди свою команду в squad wars": "Find your team in squad wars",
  "Вступить": "Join",
  "Активность в чате": "Chat activity",
  "Звёзды за сообщения и реакции": "Stars for messages and reactions",
  "Рассказать друзьям": "Tell friends",
  "По твоей ссылке друзья получают бонус, а тебе — процент с их игры.": "Friends get a bonus from your link, and you earn a share of their wins.",
  "Скопировать ссылку": "Copy link",
  "Канал AV": "AV channel",
  "Наш чат": "Our chat",
  "Приватка": "Private chat",
  "Запусти бота": "Start the bot",
  "Подписки": "Subscriptions",
  "Победы": "Wins",
  "Профит": "Profit",
  "Реф": "Ref",
  "Звезды": "Stars",
  "Баланс": "Balance",
  "Закрыть рейтинг": "Close leaderboard",
  "Закрыть кланы": "Close clans",
  "Банк месяца": "Monthly pool",
  "Забирает клан №1 в конце месяца. Делят топ-30 участников по личному вкладу.": "The #1 clan wins it at month end. Its top 30 contributors share the pool.",
  "Название клана": "Clan name",
  "Так клан появится в лиге": "This is how the clan appears in the league",
  "Иконка": "Icon",
  "Канал": "Channel",
  "необязательно": "optional",
  "Создать клан · 10 000 ★": "Create clan · 10,000 ★",
  "Как работает банк клана": "How the clan pool works",
  "Клан-войну двигают USDT-прогнозы и задания. Звёздные маркеты — личный фан.": "USDT predictions and tasks drive clan wars. Star markets are for personal play.",
  "от прибыли реальных победных ставок идёт в банк": "of profit from winning real-money bets goes to the pool",
  "клан с топом очков в конце месяца забирает весь банк": "the top-scoring clan wins the whole pool at month end",
  "самых активных делят банк по личному вкладу": "most active members split the pool by contribution",
  "Копи очки вклада — они решают, попадёшь ли ты в топ-30 и какой будет твоя доля.": "Earn contribution points: they decide whether you make the top 30 and your share.",
  "Новый участник": "New member",
  "Ежедневный вход": "Daily login",
  "Первая ставка дня": "First bet of the day",
  "Победный прогноз": "Winning prediction",
  "Подписки AV/чат": "AV/channel subscriptions",
  "Загружаю": "Loading",
  "Загружаю...": "Loading...",
  "Загружаю…": "Loading...",
  "Загружаю задания…": "Loading tasks...",
  "Загружаю прогресс…": "Loading progress...",
  "Загружаю рейтинг...": "Loading leaderboard...",
  "Загружаю кланы...": "Loading clans...",
  "Загружаю топ...": "Loading top markets...",
  "Загружаю спорт...": "Loading sports...",
  "Спортивные рынки": "Sports markets",
  "Спортивный рынок": "Sports market",
  "Закрыть спортивные рынки": "Close sports markets",
  "Закрыть ставку": "Close bet",
  "Выбери сумму": "Choose an amount",
  "Нажми сумму": "Tap an amount",
  "Ставка в один клик.": "One-tap bet.",
  "Ставка с подтверждением.": "Bet with confirmation.",
  "Режим ставки в один клик": "One-tap betting mode",
  "Режим подтверждения ставки": "Bet confirmation mode",
  "Купить": "Buy",
  "Вывести": "Withdraw",
  "Вывод": "Withdrawal",
  "Пополнение": "Deposit",
  "История кошелька": "Wallet history",
  "Зачисление": "Deposit",
  "Перевод": "Transfer",
  "Сумма пополнения": "Deposit amount",
  "Сумма вывода": "Withdrawal amount",
  "Адрес получателя": "Recipient address",
  "Создать заявку": "Create request",
  "Отменить заявку": "Cancel request",
  "Проверить зачисление": "Check deposit",
  "Скопировать адрес": "Copy address",
  "Скопировать сумму": "Copy amount",
  "Отправь ровно": "Send exactly",
  "Заявка": "Request",
  "Сети: BEP20 · ERC20": "Networks: BEP20 · ERC20",
  "Вывод пока закрыт": "Withdrawals are locked",
  "Разблокируется после первого пополнения USDT.": "Unlocks after your first USDT deposit.",
  "Скоро": "Coming soon",
  "История пока загружается.": "History is loading.",
  "Открой EasyMarket в Telegram": "Open EasyMarket in Telegram",
  "Это Mini App. В браузере снаружи Telegram ставки и баланс не откроются.": "This is a Mini App. Bets and balance are only available inside Telegram.",
  "Открыть в Telegram": "Open in Telegram",
  "Торговля": "Trading",
  "Мои заявки": "My orders",
  "Цена, ¢": "Price, ¢",
  "Нажми на цену в стакане — она подставится в заявку.": "Tap an order-book price to use it in the order.",
  "Чат": "Chat",
  "Написать сообщение...": "Write a message...",
  "Отправить": "Send",
  "Позиции": "Positions",
  "Рынки": "Markets",
  "Все": "All",
  "Позиции пока нет.": "No positions yet.",
  "Пока нет ставок.": "No bets yet.",
  "Пока нет закрытых рынков.": "No closed markets yet.",
  "Позови друга": "Invite a friend",
  "Начислим на баланс сумму пополнения: 50% сразу, 50% после ставки и 1% с побед.": "Earn their deposit amount: 50% now, 50% after their bet, plus 1% from wins.",
  "Закрыть": "Close",
  "Скрыть": "Hide",
  "Открыть": "Open",
  "Готово": "Done",
  "Ошибка": "Error",
  "Ошибка входа": "Sign-in error",
  "Нет пользователя": "No user",
  "Открой Mini App из Telegram.": "Open the Mini App from Telegram.",
  "Не удалось создать пользователя.": "Could not create the user.",
  "Рейтинг пока не загрузился.": "The leaderboard could not be loaded.",
  "Рынок пока не создан.": "The market has not been created yet.",
  "Маркеты пока не загрузились.": "Markets have not loaded yet.",
  "Спортивные рынки пока не загрузились.": "Sports markets have not loaded yet.",
  "ТОП маркеты пока не загрузились.": "Top markets have not loaded yet.",
  "В этом рейтинге пока нет участников.": "No participants in this leaderboard yet.",
  "Кланы пока не загрузились.": "Clans have not loaded yet.",
  "Сначала выбери рынок.": "Choose a market first.",
  "без ставки": "no bet",
  "Ставки": "Bets",
  "онлайн": "online",
  "Ждём итог": "Awaiting result",
  "Событие идёт сейчас": "Event is live",
  "Событие завершилось · ждём итог": "Event ended · awaiting result",
  "Рынок завершён, обновляю...": "Market ended, refreshing...",
  "Этот рынок уже завершился.": "This market has ended.",
  "Этот рынок уже завершился. Обновляю...": "This market has ended. Refreshing...",
  "Рынок уже рассчитан.": "Market already settled.",
  "Рынок уже закрылся, ждём расчёт.": "Market closed, awaiting settlement.",
  "В последние секунды продажа закрыта.": "Selling is locked in the final seconds.",
  "Продажа не прошла. Попробуй ещё раз.": "Sale failed. Try again.",
  "Покупка не прошла.": "Purchase failed.",
  "Ставку не приняли.": "Bet was not accepted.",
  "Цена рынка обновляется. Попробуй ещё раз.": "Market price is updating. Try again.",
  "Недостаточно доступного USDT.": "Not enough available USDT.",
  "Не хватает звёзд.": "Not enough stars.",
  "Не хватает shares для продажи.": "Not enough shares to sell.",
  "Лимитка выставлена.": "Limit order placed.",
  "Лимитка отменена.": "Limit order cancelled.",
  "Лимитка не создана.": "Limit order was not created.",
  "Заявка создана.": "Request created.",
  "Заявка отменена.": "Request cancelled.",
  "Заявка истекла. Создай новую.": "Request expired. Create a new one.",
  "Заявка на вывод создана.": "Withdrawal request created.",
  "Пока не вижу перевод. Проверь точную сумму и сеть.": "Payment not found yet. Check the exact amount and network.",
  "Адрес для пополнения скопирован.": "Deposit address copied.",
  "Адрес скопирован.": "Address copied.",
  "Точная сумма скопирована.": "Exact amount copied.",
  "Ссылка скопирована.": "Link copied.",
  "Ссылка для друзей готова.": "Your invite link is ready.",
  "Комментарий не отправился.": "Comment was not sent.",
  "Напиши текст.": "Write a message.",
  "Забрать": "Claim",
  "Задание уже засчитано.": "Task already completed.",
  "Не получилось забрать награду.": "Could not claim the reward.",
  "Не получилось забрать дейлик.": "Could not claim the daily reward.",
  "Не получилось открыть нужный раздел.": "Could not open that section.",
  "Звук включен.": "Sound on.",
  "Звук выключен.": "Sound off.",
  "Аквариум включен.": "Aquarium on.",
  "Аквариум выключен.": "Aquarium off.",
  "Пульс рынка включён.": "Market pulse on.",
  "Пульс рынка выключен.": "Market pulse off.",
  "Премиум анимация включена.": "Premium animation on.",
  "Премиум выключен — рыбки вернулись.": "Premium mode off — the fish are back.",
  "Раунд завершён. Готовлю следующий...": "Round over. Preparing the next one...",
  "Приём ставок закрыт, ждём следующий раунд.": "Betting closed. Waiting for the next round.",
  "Победа": "Win",
  "Ставка сыграла": "Bet settled",
  "Больше 8": "Over 8",
  "Меньше 8": "Under 8",
  "продал": "sold",
  "купил": "bought",
  "ставит": "bets",
  "Твоя ставка": "Your bet",
  "Твоя ставка:": "Your bet:",
  "% баланса": "% of balance",
  "5 BTC прогнозов": "5 BTC predictions",
  "5 побед подряд": "5 wins in a row",
  "BTC / спорт прогноз": "BTC / sports prediction",
  "BTC · 5 мин": "BTC · 5 min",
  "Share друзьям": "Share with friends",
  "USDT победа": "USDT win",
  "USDT проигрыш": "USDT loss",
  "· Найди свою команду в squad wars": "· Find your team in squad wars",
  "· аванс после проверки подписки": "· credited after subscription check",
  "· нажми Start в боте": "· tap Start in the bot",
  "· начислим сумму пополнения: 50% сразу, 50% за ставку · 1% с побед": "· earn the deposit amount: 50% now, 50% after a bet · 1% from wins",
  "· после проверки ботом": "· after the bot verifies it",
  "Банк месяца ·": "Monthly pool ·",
  "Выигрыш есть — можно поесть": "A win worth celebrating",
  "Зачислим в баланс после оплаты.": "We will credit your balance after payment.",
  "Победитель забирает весь банк за вычетом 10%. Минимум 50 ★.": "The winner takes the whole pool minus 10%. Minimum 50 ★.",
  "Позвать соперника": "Invite an opponent",
  "Премиум": "Premium",
  "Проверить честность раунда": "Verify the round",
  "Разблокировка через": "Unlocks in",
  "Сканируем сеть, ждём перевод": "Scanning the network for payment",
  "Снять за": "Remove for",
  "Страйк": "Strike",
  "ТОП": "TOP",
  "авто": "auto",
  "быстро и дёшево · советуем": "fast and inexpensive · recommended",
  "газ дороже": "higher gas fee",
  "до розыгрыша": "until the draw",
  "играй и ты →": "play now →",
  "прогнозируй · выигрывай": "predict · win",
  "Название клана": "Clan name",
  "Тряси!": "Shake!",
  "Собрано": "Collected",
  "Открыто": "Unlocked",
  "серия побед": "win streak",
  "ДРУЗЬЯ ПРИНЕСЛИ": "FRIENDS EARNED YOU",
  "Открытых заявок нет. Поставь цену в стакане.": "No open orders. Choose a price in the order book.",
  "Не получилось вступить в клан.": "Could not join the clan.",
  "Ссылка на клан скопирована.": "Clan link copied.",
  "Не получилось скопировать ссылку.": "Could not copy the link.",
  "Матч сыгран": "Match settled",
  "Прогноз зашёл": "Prediction won",
  "Спешл зашёл": "Special market won",
  "Маркеты пока загружаются.": "Markets are loading.",
  "ТОП маркеты пока загружаются.": "Top markets are loading.",
  "Спортивные рынки пока загружаются.": "Sports markets are loading.",
  "Загружаю историю...": "Loading history...",
  "Истории пополнений и выводов пока нет.": "No deposit or withdrawal history yet.",
  "История кошелька пока не загрузилась.": "Wallet history has not loaded yet.",
  "Пока нечего забирать — тряси ещё.": "Nothing to claim yet — keep shaking.",
  "Пока нечего забирать — пополни ещё.": "Nothing to claim yet — deposit more.",
  "Не получилось забрать бонус, попробуй ещё раз.": "Could not claim the bonus. Try again.",
  "Не удалось скопировать ссылку.": "Could not copy the link.",
  "Проверяю...": "Checking...",
  "Создаю заявку...": "Creating request...",
  "USDT зачислены на баланс.": "USDT credited to your balance.",
  "Пока нечего копировать.": "Nothing to copy yet.",
  "Не получилось скопировать. Скопируй вручную.": "Could not copy it. Please copy it manually.",
  "Сначала нужен пользователь.": "User authorization is required first.",
  "Введи сумму пополнения.": "Enter a deposit amount.",
  "Не получилось отменить заявку.": "Could not cancel the request.",
  "Сначала создай заявку.": "Create a request first.",
  "USDT зачислены.": "USDT credited.",
  "Заявка не найдена.": "Request not found.",
  "Проверка не прошла.": "Verification failed.",
  "Вывод разблокируется после первого пополнения USDT.": "Withdrawals unlock after your first USDT deposit.",
  "Введи сумму вывода.": "Enter a withdrawal amount.",
  "Для вывода доступен только основной USDT-баланс.": "Only your cash USDT balance can be withdrawn.",
  "Введи ERC20/BEP20 кошелек.": "Enter an ERC20/BEP20 wallet address.",
  "Не получилось создать вывод.": "Could not create the withdrawal.",
  "Скопируй адрес вручную.": "Copy the address manually.",
  "Оплата прошла. Обновляю баланс...": "Payment received. Updating balance...",
  "Оплата отменена.": "Payment cancelled.",
  "После оплаты баланс обновится автоматически.": "Your balance will update automatically after payment.",
  "Сначала нужен пользователь и активный рынок.": "User authorization and an active market are required.",
  "Проверь цену в центах и сумму лимитки.": "Check the price in cents and the limit-order amount.",
  "Не хватает shares для sell-лимитки.": "Not enough shares for the sell limit order.",
  "Не получилось отменить лимитку.": "Could not cancel the limit order.",
  "Нет активной позиции для продажи.": "No active position to sell.",
  "Не получилось вернуть ставку.": "Could not refund the bet.",
  "Ошибка обновления.": "Refresh failed.",
  "Создаю...": "Creating...",
  "Этот уровень уже забран.": "This level has already been claimed.",
  "Дневной лимит бонусов уже достигнут.": "The daily bonus limit has been reached.",
  "Прогресс ещё не дошёл до награды.": "The reward milestone has not been reached yet.",
  "Открой ссылку и попробуй забрать бонус позже.": "Open the link and claim the bonus later.",
  "Эта ступень уже забрана.": "This milestone has already been claimed.",
  "Начисление равно пополнению друга, плюс 1% с побед.": "Earn the value of your friend's deposit plus 1% from wins.",
  "Зови людей в EasyMarket": "Invite people to EasyMarket",
  "Первая ставка дня": "First bet of the day",
  "Первая победа дня": "First win of the day",
  "Поставь 1 ставку": "Place 1 bet",
  "Зачисли минимум 500 звёзд": "Deposit at least 500 stars",
  "Зачисли минимум 50 USDT": "Deposit at least 50 USDT",
  "Прогноз по BTC": "BTC prediction",
  "1 прогноз в BTC-маркете": "1 prediction in a BTC market",
  "Прогноз на спорт": "Sports prediction",
  "1 прогноз на спортивное событие": "1 sports prediction",
  "Ставка на Киевстонера": "Kyivstoner prediction",
  "1 прогноз в маркете Киевстонера": "1 Kyivstoner-market prediction",
  "BTC-прогнозы": "BTC predictions",
  "Лестница прогнозов по BTC": "BTC prediction ladder",
  "Покрутить колесо": "Spin the wheel",
  "Лестница ставок в круге": "Wheel-bet ladder",
  "Приводи тех, кто пополняет USDT": "Invite users who deposit USDT",
  "Приводи тех, кто играет на реальные": "Invite users who play with cash USDT",
  "Выиграй прогноз": "Win a prediction",
  "Серия из пяти побед": "Five-win streak",
  "2 победы подряд": "2 wins in a row",
  "Выиграй два раунда подряд": "Win two rounds in a row",
  "Против толпы": "Against the crowd",
  "Выиграй ставкой на NO": "Win with a NO bet",
  "Покорми рыбок": "Feed the fish",
  "Встряхни телефон на BTC 5m": "Shake your phone on BTC 5m",
  "Голос рынка": "Market voice",
  "Оставь комментарий под рынком": "Leave a market comment",
  "Разведка рынков": "Market explorer",
  "Открой BTC-лист, рынок из него и спорт": "Open the BTC list, one BTC market and Sports",
  "Сторис с выигрышем": "Winning story",
  "Шэрни выигрыш — можно из истории в статистике": "Share a win from your stats history",
  "Баланс звёзд": "Star balance",
  "Уровни за новые успешные пополнения": "Levels for successful new deposits",
  "Уровни за новые пополнения от 500": "Levels for new deposits from 500",
  "Все уровни забраны": "All levels claimed",
  "Готово": "Done",
  "Заморозка спасла твой стрик ❄️": "A freeze saved your streak ❄️",
  "Заряжай входами — ускоряй переход бонуса в баланс": "Check in daily to unlock your bonus faster",
  "Причина страйка не указана.": "No strike reason was provided.",
  "Недостаточно звёзд на балансе": "Not enough stars in your balance",
  "Не получилось списать": "Could not charge the balance",
  "Оплата ещё синхронизируется, нажми кнопку ещё раз через минуту": "Payment is still syncing. Try again in a minute.",
  "Оплата прошла, подтверждаю списание...": "Payment received. Confirming it...",
  "Покупка отменена.": "Purchase cancelled.",
  "После оплаты нажми кнопку ещё раз.": "Tap the button again after payment.",
  "Этот дейлик уже забран.": "This daily reward has already been claimed.",
  "Эта позиция уже не продаётся.": "This position can no longer be sold.",
  "Ставки закрыты, колесо разгоняется.": "Betting is closed. The wheel is accelerating.",
  "Крутим. Стрелка сверху выберет победителя.": "Spinning. The top pointer will select the winner.",
  "Игроков не набралось — ставки вернули на баланс.": "Not enough players. Bets were refunded.",
  "Колесо · банк на звёзды": "Wheel · star pool",
  "Раунд минуту · победитель забирает банк": "One-minute round · winner takes the pool",
  "1 BTC-прогноз": "1 BTC prediction",
  "1 спортивный прогноз": "1 sports prediction",
  "1 ставка на Киевстонера": "1 Kyivstoner prediction",
  "1 ставка в круге": "1 wheel bet",
  "Пополнить звёзды": "Top up stars",
  "Вступить в клан": "Join clan",
  "нет рынка": "no market",
  "💫 Эта победа могла капнуть в USDT — осталась ставка основными USDT": "💫 This win could unlock USDT — place one cash-USDT bet",
  "в сторис ↗": "to story ↗",
  "загружаю": "loading",
  "нет двух сторон": "both sides unavailable",
  "Киевстонер": "Kyivstoner",
  "КИЕВСТОНЕР": "KYIVSTONER",
  "Продаю...": "Selling...",
  "Вернуть 20% ставки": "Refund 20% of the bet",
  "Вернуть проигрыш": "Refund the loss",
  "Вернуть проигрыш за звезды": "Refund the loss with Stars",
  "Позови друга. После его первой ставки вернем сумму на баланс.": "Invite a friend. The amount will be credited after their first bet.",
  "выбери сумму": "choose an amount",
  "нажми сумму": "tap an amount",
  "Кланы пока не попали в рейтинг.": "No clans in the leaderboard yet.",
  "Реферальных отчислений пока нет.": "No referral earnings yet.",
  "За последние 24 часа пока нет победителей.": "No winners in the last 24 hours yet.",
  "твой": "yours",
  "лидер месяца": "monthly leader",
  "январь": "January",
  "февраль": "February",
  "март": "March",
  "апрель": "April",
  "май": "May",
  "июнь": "June",
  "июль": "July",
  "август": "August",
  "сентябрь": "September",
  "октябрь": "October",
  "ноябрь": "November",
  "декабрь": "December",
  "Лига": "League",
  "Клан": "Clan",
  "Кланы пока не созданы.": "No clans have been created yet.",
  "Ваш клан №1 — сейчас забирает банк месяца": "Your clan is #1 and currently wins the monthly pool",
  "Поднимайтесь в топ-1, чтобы забрать банк": "Reach #1 to win the pool",
  "В клане пока нет участников.": "No clan members yet.",
  "лидер": "leader",
  "Канал клана": "Clan channel",
  "Все кланы уже в топ-3 — они борются за банк выше. Вступай и двигай свой клан наверх.": "All clans are already in the top 3 above. Join one and help it climb.",
  "Войти": "Join",
  "Ты вступил в клан.": "You joined the clan.",
  "Ты вошёл в клан по ссылке.": "You joined the clan through its link.",
  "Прогноз": "Prediction",
  "статус": "status",
  "звезды": "stars",
  "Звезды зачислятся в баланс после оплаты.": "Stars will be credited after payment.",
  "Открываю оплату...": "Opening payment...",
  "Заявка создана. Отправь точную сумму.": "Request created. Send the exact amount.",
  "Эта сеть сейчас недоступна.": "This network is currently unavailable.",
  "Не получилось создать заявку.": "Could not create the request.",
  "Заявка создана и отправлена админу. Статус будет в истории.": "The request was sent to an admin. Its status will appear in history.",
  "ЗАЯВКА СОЗДАНА": "REQUEST CREATED",
  "Проверь кошелек получателя.": "Check the recipient wallet.",
  "Выбери сеть вывода.": "Choose a withdrawal network.",
  "Проверь сумму вывода.": "Check the withdrawal amount.",
  "Сумма вывода должна быть больше комиссии $3.": "The withdrawal amount must exceed the $3 fee.",
  "Покупка внутри Mini App ещё не настроена на сервере.": "Mini App purchases are not configured on the server yet.",
  "Не получилось открыть оплату.": "Could not open payment.",
  "Приём ставок закрыт, идёт финальная фиксация цены.": "Betting is closed while the final price is being recorded.",
  "Позиция уже закрыта или рассчитана.": "The position is already closed or settled.",
  "Рынок сейчас не открыт.": "The market is not open.",
  "Пользователь не найден.": "User not found.",
  "Предложение уже недоступно.": "This offer is no longer available.",
  "Этот возврат доступен через друга.": "This refund is available through a referral.",
  "Нужно 10 000 звёзд на создание клана.": "You need 10,000 stars to create a clan.",
  "Ссылка на канал выглядит неправильно.": "The channel link is invalid.",
  "Для создания клана нужно 10 000 звёзд.": "Creating a clan requires 10,000 stars.",
  "Не видим тебя в чате. Вступи и нажми ещё раз.": "You are not in the chat yet. Join and try again.",
  "Подписка не найдена. Подпишись и нажми ещё раз.": "Subscription not found. Subscribe and try again.",
  "Дневной лимит звёзд исчерпан — задание останется, забери завтра.": "The daily star limit is reached. Claim this task tomorrow.",
  "Прогресс обновляется…": "Updating progress...",
  "Задания скоро появятся.": "Tasks are coming soon.",
  "Замечена устойчиво прибыльная торговля звёздами, которая не укладывается в честную статистику — так не выигрывают на удаче.": "Unusually consistent profitable star trading was detected; this pattern does not match fair play.",
  "Замечена подозрительно быстрая серия сделок подряд — так быстро торгует скрипт, а не человек.": "A suspiciously fast sequence of trades was detected; this resembles automated activity.",
  "Замечены и подозрительно быстрая серия сделок подряд, и устойчиво прибыльная торговля звёздами, которая не укладывается в честную статистику.": "Suspiciously fast trades and statistically abnormal profitable star trading were detected.",
  "Страйк выдан вручную для проверки.": "The strike was issued manually for review.",
  "Оплачено, идёт обратный отсчёт разблокировки": "Paid. Unlock countdown is active.",
  "Оплата звёздами принята": "Stars payment received",
  "Покупка звёзд ещё не настроена на сервере": "Star purchases are not configured on the server yet",
  "Не получилось открыть покупку": "Could not open the purchase",
  "Сначала выполни это задание.": "Complete this task first.",
  "Это задание не из сегодняшней ротации.": "This task is not in today's rotation.",
  "После зачисления пополнения возврат придёт автоматически.": "The refund will arrive automatically after the deposit is credited.",
  "Пополните новые звезды. После пополнения возврат начислится автоматически, старый баланс не списываем.": "Deposit new stars. The refund will be credited automatically without charging your existing balance.",
  "Игрок": "Player",
  "Ставь первым — минута пойдёт, когда подключится второй игрок.": "Bet first. The one-minute round starts when a second player joins.",
  "Погнали крутить колесо в EasyMarket — победитель забирает весь банк.": "Spin the EasyMarket wheel with me — the winner takes the pool.",
  "Зерно откроется при раскрутке.": "The seed is revealed when the wheel spins.",
  "Проверка: sha256(зерно) должен совпасть с хешем.": "Verification: sha256(seed) must match the hash.",
  "Сегодня": "Today",
  "Завтра": "Tomorrow",
  "Скоро": "Soon",
  "на BTC за 5 минут": "on BTC 5m",
  "Это не лудка — это аналитика": "Not gambling. Pure analysis.",
  "Пока ты думал, я забрал": "While you hesitated, I won",
  "Минус? Не, не слышал": "Loss? Never heard of it",
  "на футболе": "on football",
  "Счёт на табло": "The score says it all",
  "Я знал ещё до свистка": "I knew before kickoff",
  "Даже VAR не поспорит": "Even VAR agrees",
  "Положил прогноз в девятку": "Top-corner prediction",
  "на горячем рынке": "on a hot market",
  "Увидел раньше, чем стало модно": "Saw it before it was trending",
  "Инсайдов нет — есть чуйка": "No insider info, just instinct",
  "Тренд отработал как надо": "The trend played out perfectly",
  "на рынке Киевстонера": "on the Kyivstoner market",
  "Сказал — сделал": "Called it. Won it.",
  "Чуйка не подвела": "Instinct delivered",
  "Зашло? Ещё как зашло": "Did it hit? Absolutely.",
  "Конвертация включится после ставки основными USDT": "Conversion activates after a cash-USDT bet",
  "⭐ и снять": "⭐ and remove",
  "В чат": "To chat",
  "В сторис": "To story",
  "Поделиться в сторис": "Share to story",
  "Играть": "Play",
  "Правила": "Rules",
  "Участники": "Members",
  "Очки клана": "Clan points",
  "Твои игроки": "Your players",
  "Создание": "Create",
  "Новый клан": "New clan",
  "Клан создан.": "Clan created.",
  "Клан не создан.": "Clan was not created.",
  "Название клана слишком короткое.": "Clan name is too short.",
  "Такой клан уже есть.": "That clan already exists.",
  "Пополнить звезды": "Top up stars",
  "Пополнить USDT": "Top up USDT",
  "Пополнения USDT": "USDT deposits",
  "Пополнения звёзд": "Star deposits",
  "Пополнения друзей": "Friend deposits",
  "Холд USDT": "Hold USDT",
  "Ежедневные очки за основной баланс": "Daily points for cash balance",
  "Ежедневные очки за звёзды": "Daily points for stars",
  "дней": "days",
  "день": "day",
  "дня": "days",
  "скоро": "soon",
  "в обработке": "processing",
  "зачислено": "credited",
  "выведено": "withdrawn",
  "отменено": "cancelled",
  "истекло": "expired",
  "ошибка": "error",
  "да": "yes",
  "нет": "no",
  "ты": "you",
  "Твой": "Yours",
  "свежие": "recent",
  "Цена": "Price",
  "Объём": "Volume",
  "Всего": "Total",
  "Рефералы": "Referrals",
  "пока никого": "no one yet",
  "Пригласи друга: половина бонуса придёт после его пополнения, вторая — после ставки на реальные. Плюс 1% с побед.": "Invite a friend: half the bonus arrives after their deposit, the other half after their first cash-USDT bet. Plus 1% from their wins.",
  "Бонусы за приглашения": "Invite bonuses",
  "Прибыль за их победы": "Profit from their wins",
  "Пока нет рассчитанных рынков. Сделай ставку и дождись закрытия маркета.": "No settled markets yet. Place a bet and wait for the market to close.",
  "винрейт": "win rate",
  "ставок": "bets",
  "лучшее": "best",
  "Назад к списку сделок": "Back to trade history",
  "Открыть расчёт сделки": "Open trade breakdown",
  "Ставка": "Bet",
  "Выплата": "Payout",
  "· закрывается": "· closing",
  "Позвать друга": "Invite a friend",
  "место": "rank",
  "очки месяца": "points this month",
  "за всё время": "all-time",
  "состав": "roster",
  "Как поднять клан наверх": "How to climb the clan ranks",
  "USDT-прогноз — победа": "USDT prediction — win",
  "Заходи каждый день": "Check in daily",
  "Серия из 5 побед": "5-win streak",
  "Позвать друга в клан": "Invite a friend to the clan",
  "Позвать в клан": "Invite to the clan",
  "Счёт идёт за текущий месяц и обнуляется первого числа. В конце месяца весь банк уходит клану №1 и делится между топ-30 участниками пропорционально их очкам за этот месяц.": "The score runs for the current month and resets on the 1st. At month end, the whole pool goes to clan #1, split among the top 30 contributors in proportion to their points that month.",
  "Комиссия": "Fee",
  "Получишь": "You'll receive",
  "Останется": "Remaining",
}));

const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let currentLanguage = "ru";
let observer = null;
let queuedRoots = new Set();
let translateFrame = null;

function normalizeLanguage(value) {
  const code = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "ru" || code === "uk") return "ru";
  return "en";
}

function parseInitDataLanguage(initData) {
  try {
    const rawUser = new URLSearchParams(initData || "").get("user");
    return rawUser ? JSON.parse(rawUser)?.language_code : null;
  } catch {
    return null;
  }
}

function detectLanguage() {
  const tg = window.Telegram?.WebApp;
  const languageCode = tg?.initDataUnsafe?.user?.language_code
    || parseInitDataLanguage(tg?.initData)
    || navigator.language
    || "en";
  return normalizeLanguage(languageCode);
}

function readSavedLanguage() {
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.has(saved) ? saved : null;
  } catch {
    return null;
  }
}

function preserveSpacing(source, translated) {
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

function translatePatternToEnglish(value) {
  if (value.startsWith("Telegram.WebApp:")) {
    return value
      .replaceAll("да", "yes")
      .replaceAll("нет", "no");
  }
  const rules = [
    [/^⚡ x2 на (\d+) секунд — успей поставить!$/, "⚡ x2 for $1 seconds — place your bet!"],
    [/^💫 Эта победа могла капнуть в USDT — для запуска пополни от (.*)$/, "💫 This win could unlock USDT — activate it with a deposit of $1"],
    [/^Маркет #(\d+)$/, "Market #$1"],
    [/^(\d+) поз\.(.*)$/, "$1 pos.$2"],
    [/^(.*?) · (.*?) · всего \+(.*)$/, "$1 · $2 · total +$3"],
    [/^(\d+) побед · лучший (.*)$/, "$1 wins · best $2"],
    [/^(\d+) рефералов · (\d+) начислений$/, "$1 referrals · $2 rewards"],
    [/^(\d+) ставок · WR (.*)$/, "$1 bets · WR $2"],
    [/^(\d+) дн (\d+) ч$/, "$1d $2h"],
    [/^(\d+) ч (\d+) мин$/, "$1h $2m"],
    [/^Вы на (\d+) месте\. Банк уходит клану №1 — обгоняйте лидера$/, "You are #$1. The #1 clan wins the pool — catch the leader"],
    [/^Вступай в клан (.*?) в EasyMarket\.$/, "Join the $1 clan in EasyMarket."],
    [/^(.*?)\. Играй и ты в EasyMarket →$/, "$1. Play in EasyMarket →"],
    [/^(.*?) · получит (.*?) · комиссия (.*)$/, "$1 · receives $2 · fee $3"],
    [/^Вывести (.*)$/, "Withdraw $1"],
    [/^Доступно: (.*)$/, "Available: $1"],
    [/^Доступно для вывода: (.*?) \(основной баланс\)$/, "Available to withdraw: $1 (cash balance)"],
    [/^Минимальная сумма вывода (.*)$/, "Minimum withdrawal: $1"],
    [/^Заявка создана\. Сумма (.*?) скопирована — вставь в кошелёк\.$/, "Request created. $1 was copied — paste it into your wallet."],
    [/^Для лимитки не хватает (.*)\.$/, "Not enough $1 for the limit order."],
    [/^Для ставки (.*?) не хватает (.*?)\.$/, "Not enough $2 for a $1 bet."],
    [/^На баланс (.*?) · PnL (.*)$/, "To balance $1 · PnL $2"],
    [/^(\d+) победы подряд$/, "$1 wins in a row"],
    [/^Списано (.*?)★, осталась оплата звёздами$/, "$1★ charged; complete the remaining Stars payment"],
    [/^ставит (.*) ★$/, "bets $1 ★"],
    [/^Твой банк — (.*) ★\.$/, "Your pool is $1 ★."],
    [/^(.*?) забрал (.*?) ★\.$/, "$1 won $2 ★."],
    [/^Банк (.*?) ★ ждёт соперника\. Зайди — и он может достаться тебе\.$/, "A $1 ★ pool is waiting for an opponent. Join and it could be yours."],
    [/^В EasyMarket висит банк (.*?) ★ и ждёт соперника\. Крутанём\?$/, "A $1 ★ EasyMarket pool is waiting for an opponent. Spin it?"],
    [/^Хеш зерна: (.*)$/, "Seed hash: $1"],
    [/^Зерно: (.*)$/, "Seed: $1"],
    [/^Точка остановки: (.*)$/, "Stop point: $1"],
    [/^Пополни от (.*?) — и вернём 20% проигранной ставки на баланс\.$/, "Deposit $1 and get 20% of the losing bet back."],
    [/^Нужно пополнить (.*?) новых звезд\. Старые звезды не списываем\.$/, "Deposit $1 new stars. Existing stars will not be charged."],
    [/^Сегодня · (.*)$/, "Today · $1"],
    [/^Завтра · (.*)$/, "Tomorrow · $1"],
    [/^Разблокировка: до (.*?)% от прибыли(.*)$/, "Unlock: up to $1% of profit$2"],
    [/^Разблокировка после депозита от (.*)$/, "Unlocks after a deposit of $1"],
    [/^Бонус: (.*)$/, "Bonus: $1"],
    [/^Скопировать точную сумму (.*)$/, "Copy exact amount $1"],
    [/^Скопировать адрес для пополнения (.*)$/, "Copy deposit address $1"],
    [/^Пополнить звезды$/, "Top up stars"],
    [/^Вывести звезды$/, "Withdraw stars"],
    [/^Конвертировано \$(.*?) из \$(.*?) · пополни ещё — потолок вырастет(.*)$/, "Converted $$$1 of $$$2 · deposit more to raise the limit$3"],
    [/^💫 Конвертация почти включена — осталась ставка основными USDT$/, "💫 Conversion is almost active — place one cash-USDT bet"],
    [/^💫 (.*?)⭐ — это до \$(.*?) · заморожено, пополни ещё (.*)$/, "💫 $1⭐ can unlock up to $$$2 · locked, deposit $3 more"],
    [/^💫 (.*?)⭐ — это до \$(.*?) · заморожено, пополни от (.*)$/, "💫 $1⭐ can unlock up to $$$2 · locked, deposit at least $3"],
    [/^Конвертация звёзд в USDT включится после пополнения от (.*)$/, "Star-to-USDT conversion activates after a deposit of $1"],
    [/^Забрать \$(.*)$/, "Claim $$$1"],
    [/^\+\$(.*?) начислено на баланс\. Рыбки сыты!$/, "+$$$1 credited. The fish are fed!"],
    [/^\+\$(.*?) начислено на баланс\.$/, "+$$$1 credited to your balance."],
    [/^Есть выигрыш: (.*)$/, "You have a win: $1"],
    [/^Минимальное пополнение (.*)\.$/, "Minimum deposit: $1."],
    [/^Минимальная сумма вывода (.*)\.$/, "Minimum withdrawal: $1."],
    [/^Продажа не прошла: (.*)$/, "Sale failed: $1"],
    [/^Возврат начислен: (.*)$/, "Refund credited: $1"],
    [/^Ещё (\d+) мин активной игры\.$/, "$1 more minutes of active play."],
    [/^\+(.*?) за друзей\.$/, "+$1 for referrals."],
    [/^\+(.*?) за задание\.$/, "+$1 for the task."],
    [/^\+(.*?) за (\d+) минут в игре\.$/, "+$1 for $2 minutes in the app."],
    [/^\+(.*?) за дейлик\.$/, "+$1 for the daily task."],
    [/^\+(.*?) за запуск бота\.$/, "+$1 for starting the bot."],
    [/^После подписки на приватку AV-бот начислит аванс (.*)\.$/, "After you join the private channel, the AV bot will credit $1."],
    [/^Лутбокс за 7 дней подряд: (.*)$/, "7-day streak lootbox: $1"],
    [/^Стрик: (\d+) дн\. подряд (.*)$/, "Streak: $1 days $2"],
    [/^Бонус → баланс x(.*?) быстрее · лутбокс на 7-й день$/, "Bonus unlocks x$1 faster · lootbox on day 7"],
    [/^Уровень (\d+)\/(\d+)$/, "Level $1/$2"],
    [/^Все (\d+) уровней пройдены$/, "All $1 levels completed"],
    [/^(\d+) друзей$/, "$1 friends"],
    [/^(\d+) ставок за день$/, "$1 daily bets"],
    [/^Пополнить (.*?) звёзд$/, "Deposit $1 stars"],
    [/^(\d+) BTC-прогноз(?:ов)?$/, "$1 BTC predictions"],
    [/^(\d+) спортивн(?:ый|ых) прогноз(?:ов)?$/, "$1 sports predictions"],
    [/^(\d+) став(?:ка|ок) на Киевстонера$/, "$1 Kyivstoner predictions"],
    [/^(\d+) став(?:ка|ок) в круге$/, "$1 wheel bets"],
    [/^Друзья пополнили \$(.*)$/, "Friends deposited $$$1"],
    [/^\$(.*?) комиссии с рефералов$/, "$$$1 referral commission"],
    [/^(\d+) побед за день$/, "$1 daily wins"],
    [/^(\d+) побед подряд$/, "$1 wins in a row"],
    [/^(\d+) NO-побед$/, "$1 NO wins"],
    [/^(\d+) кормление рыбок$/, "$1 fish feeds"],
    [/^(\d+) сообщений в чат$/, "$1 chat messages"],
    [/^(\d+) рынков разведать$/, "Explore $1 markets"],
    [/^(\d+) сторис с выигрышем$/, "$1 winning stories"],
    [/^Банк (\d+) ★ ушёл другому\. Следующий раунд уже идёт\.$/, "Another player won the $1 ★ pool. The next round is live."],
    [/^банк (\d+) ★$/, "pool $1 ★"],
    [/^Твоя доля (\d+)% · шанс выиграть ровно столько же\.$/, "Your share is $1% · your win chance is the same."],
    [/^(.*?) · шанс выиграть ровно столько же\.$/, "$1 · the win chance is the same."],
    [/^Победа (.*)$/, "Win: $1"],
    [/^(.*?) · Ставки: (.*)$/, "$1 · Bets: $2"],
    [/^(.*?) из (.*?)$/, "$1 of $2"],
    [/^(\d+) из (\d+)$/, "$1 of $2"],
    [/^(\d+) мин$/, "$1 min"],
    [/^(\d+) дн(?:я|ей)?$/, "$1 days"],
    [/^(\d+) ч(?:ас(?:а|ов)?)?$/, "$1h"],
    [/^Уровень (.+)$/, "Level $1"],
    [/^Начало (.+)$/, "Starts $1"],
    [/^Сейчас(?: · (.+))?$/, (_, details) => details ? `Live · ${details}` : "Live"],
    [/^Ставки: (.+)$/, "Bets: $1"],
    [/^онлайн:(.*)$/i, "online:$1"],
    [/^Забрать (.+)$/, "Claim $1"],
    [/^Купить (.+)$/, "Buy $1"],
    [/^Продать (.+)$/, "Sell $1"],
    [/^Пополнить (.+)$/, "Top up $1"],
    [/^Сумма для (.+)$/, "Amount for $1"],
    [/^Нажми сумму для (.+)$/, "Tap an amount for $1"],
    [/^До конца: (.+)$/i, "Ends in: $1"],
    [/^до розыгрыша (.+)$/i, "draw in $1"],
    [/^Раунд #(\d+)$/, "Round #$1"],
    [/^Победа (.+)$/, "Win: $1"],
    [/^Загружаю (.+?)(?:\.{3}|…)?$/, "Loading $1..."],
    [/^Не хватает (.+)$/, "Not enough $1"],
    [/^Все (\d+)$/, "All $1"],
    [/^(\d+) ставок$/, "$1 bets"],
    [/^(\d+) побед$/, "$1 wins"],
    [/^(\d+) рефералов$/, "$1 referrals"],
    [/^(\d+) поз\.$/, "$1 pos."],
    [/^ставка (.+)$/i, "bet $1"],
    [/^исход (.+)$/i, "outcome $1"],
    [/^([\d,]+) участников$/, "$1 members"],
    [/^([\d,]+) очков за месяц$/, "$1 points this month"],
    [/^([\d,]+) всего$/, "$1 total"],
    [/^Твой клан: (.+)$/, "Your clan: $1"],
    [/^Вклад за месяц (.+?) · место #(.+)$/, "Contribution this month $1 · rank #$2"],
    [/^спред (.+)$/i, "spread $1"],
    [/^(.+) зв\.$/, "$1 stars"],
    [/^\+(.+)\/день$/, "+$1/day"],
    [/^\+(.+) оч\.$/, "+$1 pts"],
    [/^1 друг$/, "1 friend"],
    [/^(\d+) друг$/, "$1 friends"],
    [/^(\d+) друга$/, "$1 friends"],
    [/^(\d+) друзей$/, "$1 friends"],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

const CYRILLIC_RE = /[а-яА-ЯёЁ]/;

export function translateText(value) {
  const source = String(value ?? "");
  if (currentLanguage !== "en" || !source.trim()) return source;
  const trimmed = source.trim();
  const exact = EXACT_EN.get(trimmed);
  if (exact) return preserveSpacing(source, exact);

  const patterned = translatePatternToEnglish(trimmed);
  if (!CYRILLIC_RE.test(patterned)) return preserveSpacing(source, patterned);

  // Many rendered strings are several clauses joined with " · " (e.g. a trade's
  // "bet YES · outcome YES · 3 pos. · STAR"). A single whole-string pattern
  // above can match just the first clause and pass the rest through untouched
  // (its capture group swallows the remainder verbatim). When that leaves
  // Cyrillic behind, translate each " · "-separated clause on its own and
  // rejoin, so a pattern that only covers one clause doesn't block the others.
  if (trimmed.includes(" · ")) {
    const bySegment = trimmed.split(" · ").map((part) => translateText(part)).join(" · ");
    if (!CYRILLIC_RE.test(bySegment)) return preserveSpacing(source, bySegment);
    if (bySegment !== trimmed) return preserveSpacing(source, bySegment);
  }

  return preserveSpacing(source, patterned);
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.matches("script, style, textarea, option")) return true;
  if (parent.matches(".chat-row > p")) return true;
  return Boolean(parent.closest("[data-i18n-skip]"));
}

function translateTextNode(node) {
  if (shouldSkipTextNode(node)) return;
  if (currentLanguage === "ru") {
    const original = originalText.get(node);
    if (original !== undefined && node.nodeValue !== original) node.nodeValue = original;
    return;
  }
  const translated = translateText(node.nodeValue);
  if (translated !== node.nodeValue) {
    originalText.set(node, node.nodeValue);
    node.nodeValue = translated;
  }
}

function translateElementAttributes(element) {
  const attributes = ["aria-label", "placeholder", "title"];
  if (currentLanguage === "ru") {
    const originals = originalAttributes.get(element);
    if (!originals) return;
    for (const [name, value] of Object.entries(originals)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
    return;
  }

  for (const name of attributes) {
    if (!element.hasAttribute(name)) continue;
    const value = element.getAttribute(name);
    const translated = translateText(value);
    if (translated === value) continue;
    const originals = originalAttributes.get(element) || {};
    originals[name] = value;
    originalAttributes.set(element, originals);
    element.setAttribute(name, translated);
  }
}

export function translateDom(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

  if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
  const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element = elementWalker.nextNode();
  while (element) {
    translateElementAttributes(element);
    element = elementWalker.nextNode();
  }
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    translateTextNode(textNode);
    textNode = textWalker.nextNode();
  }
}

function flushTranslationQueue() {
  translateFrame = null;
  const roots = Array.from(queuedRoots);
  queuedRoots.clear();
  roots.forEach((root) => translateDom(root));
}

function queueTranslation(root) {
  if (!root) return;
  queuedRoots.add(root);
  if (translateFrame === null) translateFrame = requestAnimationFrame(flushTranslationQueue);
}

function startObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        queueTranslation(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(queueTranslation);
      if (mutation.type === "attributes") queueTranslation(mutation.target);
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "placeholder", "title"],
  });
}

function stopObserver() {
  observer?.disconnect();
  observer = null;
  queuedRoots.clear();
  if (translateFrame !== null) {
    cancelAnimationFrame(translateFrame);
    translateFrame = null;
  }
}

function updateLanguageControls() {
  document.querySelectorAll("[data-language-option]").forEach((button) => {
    const active = button.dataset.languageOption === currentLanguage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  if (currentLanguage === "ru") stopObserver();
  translateDom(document.body);
  updateLanguageControls();
  if (currentLanguage === "en") startObserver();
}

export function getLanguage() {
  return currentLanguage;
}

export function getIntlLocale() {
  return currentLanguage === "ru" ? "ru-RU" : "en-US";
}

export function setLanguage(language, { persist = true } = {}) {
  const next = SUPPORTED_LANGUAGES.has(language) ? language : normalizeLanguage(language);
  if (persist) {
    try {
      window.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // Telegram private mode can disable local storage.
    }
  }
  const changed = next !== currentLanguage;
  currentLanguage = next;
  applyLanguage();
  if (changed) window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language: next } }));
  return currentLanguage;
}

export function initI18n() {
  currentLanguage = readSavedLanguage() || detectLanguage();
  applyLanguage();
  return currentLanguage;
}

export function onLanguageChange(listener) {
  const handler = (event) => listener(event.detail?.language || currentLanguage);
  window.addEventListener(LANGUAGE_EVENT, handler);
  return () => window.removeEventListener(LANGUAGE_EVENT, handler);
}
