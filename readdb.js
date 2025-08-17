const { Level } = require('level');
const path = require('path');

async function main() {
    const dbPath = path.join(__dirname, 'tonkoin-db');
    const db = new Level(dbPath, { valueEncoding: 'json' });

    // Явно открываем базу данных
    await db.open();

    console.log('=== Чтение всех данных из LevelDB ===');

    try {
        // Чтение пользователей
        console.log('\nПользователи:');
        const userStream = db.iterator({ gt: 'user_', lt: 'user_\xFF' });
        for await (const [key, value] of userStream) {
            const userId = key.replace('user_', '');
            console.log(`ID: ${userId}`, 'Данные:', value);
        }

        // Чтение рефералов
        console.log('\nРеферальные связи:');
        const refStream = db.iterator({ gt: 'ref_', lt: 'ref_\xFF' });
        for await (const [key] of refStream) {
            const [inviterId, referralId] = key.split('_').slice(1);
            console.log(`Пригласитель: ${inviterId} → Реферал: ${referralId}`);
        }

        // Чтение задач
        try {
            const tasks = await db.get('tasks');
            console.log('\nЗадания:', tasks);
        } catch (e) {
            console.log('\nЗадания отсутствуют');
        }
    } finally {
        // Закрываем базу после использования
        await db.close();
    }
}

main().catch(console.error);