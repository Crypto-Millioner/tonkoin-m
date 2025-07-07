const { Level } = require('level');
const path = require('path');

const dbPath = path.join(__dirname, 'tonkoin-db');
const db = new Level(dbPath, { valueEncoding: 'json' });

class Database {
    // Пользователи
    async getUser(userId) {
        try {
            return await db.get(`user_${userId}`);
        } catch (e) {
            return null;
        }
    }

    async saveUser(user) {
        await db.put(`user_${user.id}`, user);
    }

async findUserByUsername(username) {
    const users = [];
    for await (const [key, value] of db.iterator()) {
        if (key.startsWith('user_')) {
            const user = JSON.parse(value);
            if (user.username && user.username.toLowerCase() === username.toLowerCase()) {
                users.push(user);
            }
        }
    }
    return users;
}

    async updateUser(userId, updateFn) {
        const user = await this.getUser(userId) || {
            id: userId,
            balance: 0,
            miningBalance: 0,
            miningRate: 0.0000001000,
            upgraded: false,
            miningActive: false,
            tasksCompleted: [],
            lastMiningUpdate: Date.now()
        };
        
        updateFn(user);
        await this.saveUser(user);
        return user;
    }

    // Рефералы
    async addReferral(inviterId, referralId) {
        const key = `ref_${inviterId}_${referralId}`;
        await db.put(key, '1');
    }

    async getReferralsCount(userId) {
        let count = 0;
        for await (const [key] of db.keys({ 
            gte: `ref_${userId}_`, 
            lte: `ref_${userId}_\xff` 
        })) {
            count++;
        }
        return count;
    }

    // Задания
    async addTask(task) {
        const tasks = await this.getTasks();
        tasks.push(task);
        await db.put('tasks', tasks);
    }

    async getTasks() {
        try {
            return await db.get('tasks') || [];
        } catch (e) {
            return [];
        }
    }

    // Получение всех пользователей
    async getAllUsers() {
        const users = [];
        for await (const [key, value] of db.iterator({ 
            gt: 'user_', 
            lte: 'user_\xff' 
        })) {
            users.push(value);
        }
        return users;
    }
}

module.exports = new Database();