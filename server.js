const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const JWT_SECRET = process.env.JWT_SECRET || "cpahub-secret-key";

const db = new Database("./cpahub.db");
console.log("SQLite (better-sqlite3) conectado com sucesso");
initDB();

function initDB() {
    const tableStatements = [
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            password TEXT,
            subid TEXT UNIQUE,
            balance REAL DEFAULT 0,
            pix_key TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            desc TEXT,
            payout REAL DEFAULT 0,
            link TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            offer_id INTEGER,
            subid TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (offer_id) REFERENCES offers(id)
        )`,
        `CREATE TABLE IF NOT EXISTS conversions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subid TEXT,
            offer_id INTEGER,
            payout REAL,
            status TEXT DEFAULT 'approved',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(subid, offer_id)
        )`,
        `CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            pix_key TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    ];

    tableStatements.forEach((sql) => db.prepare(sql).run());

    const { count } = db.prepare("SELECT COUNT(*) as count FROM offers").get();
    if (count === 0) {
        db.prepare(`INSERT INTO offers (title, desc, payout, link) VALUES (?, ?, ?, ?)`)
            .run("Cadastro R�pido", "Complete o cadastro e ganhe recompensa", 5.0, "https://JOINADS-LINK.com?subid=");
    }
}

function checkFraud(subid, ip, offerId) {
    const row = db.prepare("SELECT COUNT(*) as count FROM clicks WHERE ip_address = ? AND offer_id = ? AND subid != ?").get(ip, offerId, subid);
    return row.count > 0;
}

app.post("/register", (req, res) => {
    const { name, email, password, pix_key } = req.body;
    const subid = uuidv4();
    const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    try {
        db.prepare(`INSERT INTO users (id, name, email, password, subid, pix_key, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), name, email || null, hashedPassword, subid, pix_key || null, ip);
        res.json({ subid, name, balance: 0 });
    } catch (err) {
        if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(400).json({ error: "Email j� cadastrado" });
        }
        return res.status(500).json({ error: err.message });
    }
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;

    try {
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user) return res.status(404).json({ error: "Usu�rio n�o encontrado" });

        if (password && !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: "Senha incorreta" });
        }

        const token = jwt.sign({ subid: user.subid, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
        res.json({ token, subid: user.subid, name: user.name, balance: user.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/reset-password", (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email obrigat�rio" });
    }

    try {
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user) {
            return res.json({ message: "Se este email estiver cadastrado, voc� receber� uma nova senha em breve." });
        }

        const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
        const hashedPassword = bcrypt.hashSync(tempPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE email = ?").run(hashedPassword, email);

        console.log(`?? Nova senha para ${email}: ${tempPassword}`);
        res.json({
            message: "Senha redefinida com sucesso!",
            tempPassword,
            note: "Em produ��o, esta senha seria enviada por email"
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/offers", (req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM offers WHERE active = 1").all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/click/:offerId/:subid", (req, res) => {
    const { offerId, subid } = req.params;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];

    try {
        const user = db.prepare("SELECT * FROM users WHERE subid = ?").get(subid);
        if (!user) return res.status(404).send("Usu�rio n�o encontrado");

        const offer = db.prepare("SELECT * FROM offers WHERE id = ?").get(offerId);
        if (!offer) return res.status(404).send("Oferta n�o encontrada");

        db.prepare(`INSERT INTO clicks (user_id, offer_id, subid, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`)
            .run(user.id, offerId, subid, ip, userAgent);

        res.redirect(offer.link + subid);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get("/postback", (req, res) => {
    const { subid, status, offer_id, payout } = req.query;
    if (status !== "approved") return res.send("ignored");

    try {
        const existing = db.prepare("SELECT * FROM conversions WHERE subid = ? AND offer_id = ?").get(subid, offer_id);
        if (existing) return res.send("already counted");

        const user = db.prepare("SELECT * FROM users WHERE subid = ?").get(subid);
        if (!user) return res.send("user not found");

        const payoutValue = parseFloat(payout) || 0;
        db.prepare(`INSERT INTO conversions (subid, offer_id, payout) VALUES (?, ?, ?)`)
            .run(subid, offer_id, payoutValue);
        db.prepare(`UPDATE users SET balance = balance + ? WHERE subid = ?`).run(payoutValue, subid);

        res.send("ok");
    } catch (err) {
        res.status(500).send("error");
    }
});

app.get("/balance/:subid", (req, res) => {
    try {
        const row = db.prepare("SELECT balance, name FROM users WHERE subid = ?").get(req.params.subid);
        if (!row) return res.status(404).json({ error: "Usu�rio n�o encontrado" });
        res.json({ balance: row.balance, name: row.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/withdraw", (req, res) => {
    const { subid, pix_key, amount } = req.body;
    if (!pix_key || !amount || amount <= 0) {
        return res.status(400).json({ error: "Dados inv�lidos" });
    }

    try {
        const user = db.prepare("SELECT * FROM users WHERE subid = ?").get(subid);
        if (!user) return res.status(404).json({ error: "Usu�rio n�o encontrado" });
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });

        db.prepare(`UPDATE users SET balance = balance - ? WHERE subid = ?`).run(amount, subid);
        const result = db.prepare(`INSERT INTO withdrawals (user_id, pix_key, amount) VALUES (?, ?, ?)`)
            .run(user.id, pix_key, amount);

        res.json({
            message: "Saque solicitado com sucesso",
            id: result.lastInsertRowid,
            status: "pending",
            amount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/withdrawals/:subid", (req, res) => {
    try {
        const user = db.prepare("SELECT id FROM users WHERE subid = ?").get(req.params.subid);
        if (!user) return res.status(404).json({ error: "Usu�rio n�o encontrado" });

        const rows = db.prepare("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC").all(user.id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/admin/users", (req, res) => {
    try {
        const rows = db.prepare("SELECT subid, name, email, balance, created_at FROM users").all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/admin/stats", (req, res) => {
    try {
        const users = db.prepare("SELECT COUNT(*) as total_users FROM users").get();
        const clicks = db.prepare("SELECT COUNT(*) as total_clicks FROM clicks").get();
        const conversions = db.prepare("SELECT COUNT(*) as total_conversions FROM conversions").get();
        const paid = db.prepare("SELECT SUM(payout) as total_paid FROM conversions").get();
        const pending = db.prepare("SELECT SUM(amount) as pending_withdrawals FROM withdrawals WHERE status = 'pending'").get();

        res.json({
            users: users.total_users,
            clicks: clicks.total_clicks,
            conversions: conversions.total_conversions,
            total_paid: paid.total_paid || 0,
            pending_withdrawals: pending.pending_withdrawals || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/admin/withdrawals", (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT w.*, u.name, u.email FROM withdrawals w 
            JOIN users u ON w.user_id = u.id 
            WHERE w.status = 'pending' ORDER BY w.created_at DESC
        `).all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/admin/withdrawals/:id", (req, res) => {
    const { status } = req.body;
    try {
        db.prepare("UPDATE withdrawals SET status = ? WHERE id = ?").run(status, req.params.id);
        res.json({ message: `Saque ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/admin/offers", (req, res) => {
    const { title, desc, payout, link } = req.body;
    try {
        const result = db.prepare(`
            INSERT INTO offers (title, desc, payout, link) VALUES (?, ?, ?, ?)`
        ).run(title, desc, payout, link);
        res.json({ id: result.lastInsertRowid, title, desc, payout, link });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════════════╝');
    console.log('║     CPA Hub Pro v2.0 - Ativo!          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  ➜  Local:   http://localhost:${PORT}       ║`);
    console.log(`║  ➜  Rede:    http://0.0.0.0:${PORT}         ║`);
    console.log('╚════════════════════════════════════════╝');
});
