const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const db = require('./database'); // Импортируем существующее подключение

const app = express();
const PORT = 3001;

app.use(express.static(path.join(__dirname)));

const server = app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

async function broadcastData() {
  try {
    const users = await db.getAllUsers() || [];
    const referrals = [];
    
    // Получаем рефералов для каждого пользователя
    for (const user of users) {
      const count = await db.getReferralsCount(user.id) || 0;
      if (count > 0) {
        referrals.push({
          inviterId: user.id,
          referralCount: count
        });
      }
    }

    const tasks = await db.getTasks() || [];

    const data = {
      users,
      referrals,
      tasks
    };

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  } catch (e) {
    console.error('Ошибка при получении данных:', e);
  }
}

setInterval(broadcastData, 3000); // Интервал изменен на 3000 мс
broadcastData();