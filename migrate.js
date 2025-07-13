const { Level } = require('level');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Укажите правильный путь к LevelDB
const dbPath = 'C:/Users/User/Downloads/CryptoS/tonbot/tonkoin-db';
const db = new Level(dbPath);

// Настройки Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function migrateUsers() {
  console.log('Начало миграции пользователей...');
  
  // Используем итератор вместо createReadStream
  const iterator = db.iterator({
    gt: 'user:',
    lt: 'user:~',
    keys: true,
    values: true
  });
  
  let count = 0;
  
  for await (const [key, value] of iterator) {
    try {
      const user = JSON.parse(value);
      
      // Преобразование данных в формат Supabase
      const supabaseUser = {
        id: user.id,
        username: user.username,
        balance: user.balance,
        mining_balance: user.miningBalance,
        mining_rate: user.miningRate,
        upgraded: user.upgraded,
        mining_active: user.miningActive,
        tasks_completed: JSON.stringify(user.tasksCompleted),
        last_mining_update: user.lastMiningUpdate
      };

      // Вставка в Supabase
      const { error } = await supabase
        .from('users')
        .upsert([supabaseUser]);

      if (error) throw error;
      
      count++;
      if (count % 100 === 0) console.log(`Мигрировано ${count} пользователей`);
    } catch (e) {
      console.error(`Ошибка миграции ${key}:`, e);
    }
  }
  
  console.log(`Успешно мигрировано пользователей: ${count}`);
  await iterator.close();
}

async function migrateReferrals() {
  console.log('Начало миграции рефералов...');
  
  // Используем итератор
  const iterator = db.iterator({
    gt: 'referral:',
    lt: 'referral:~',
    keys: true,
    values: true
  });
  
  let count = 0;
  const referralsBatch = [];
  
  for await (const [key, value] of iterator) {
    try {
      const [_, inviterId, referralId] = key.split(':');
      referralsBatch.push({
        inviter_id: parseInt(inviterId),
        referral_id: parseInt(referralId)
      });
      
      count++;
      if (referralsBatch.length >= 100) {
        const { error } = await supabase
          .from('referrals')
          .insert(referralsBatch);
        
        if (error) throw error;
        referralsBatch.length = 0;
        console.log(`Мигрировано ${count} рефералов`);
      }
    } catch (e) {
      console.error(`Ошибка миграции ${key}:`, e);
    }
  }

  // Вставка оставшихся
  if (referralsBatch.length > 0) {
    await supabase.from('referrals').insert(referralsBatch);
  }
  
  console.log(`Успешно мигрировано рефералов: ${count}`);
  await iterator.close();
}

async function migrateTasks() {
  console.log('Начало миграции заданий...');
  
  // Используем итератор
  const iterator = db.iterator({
    gt: 'task:',
    lt: 'task:~',
    keys: true,
    values: true
  });
  
  let count = 0;
  
  for await (const [key, value] of iterator) {
    try {
      const task = JSON.parse(value);
      const taskId = key.split(':')[1];
      
      const { error } = await supabase
        .from('tasks')
        .upsert([{
          id: taskId,
          link: task.link,
          reward: task.reward
        }]);

      if (error) throw error;
      
      count++;
      console.log(`Мигрировано задание: ${taskId}`);
    } catch (e) {
      console.error(`Ошибка миграции ${key}:`, e);
    }
  }
  
  console.log(`Успешно мигрировано заданий: ${count}`);
  await iterator.close();
}

async function main() {
  try {
    console.log('Открытие базы данных LevelDB...');
    await db.open(); // Явное открытие базы
    
    console.log('Начало миграции...');
    await migrateUsers();
    await migrateReferrals();
    await migrateTasks();
    
    console.log('Миграция завершена успешно!');
  } catch (e) {
    console.error('Ошибка в основном потоке миграции:', e);
  } finally {
    console.log('Закрытие базы данных...');
    await db.close();
  }
}

main();