const express = require("express");
const sqlite3 = require("sqlite3").verbose();
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

// Inicializa SQLite
const db = new sqlite3.Database("./cpahub.db", (err) => {
    if (err) {
        console.error("Erro ao conectar SQLite:", err);
    } else {
        console.log("SQLite conectado com sucesso");
        initDB();
    }
});

// Cria tabelas
function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            password TEXT,
            subid TEXT UNIQUE,
            balance REAL DEFAULT 0,
            pix_key TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            desc TEXT,
            payout REAL DEFAULT 0,
            link TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            offer_id INTEGER,
            subid TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (offer_id) REFERENCES offers(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS conversions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subid TEXT,
            offer_id INTEGER,
            payout REAL,
            status TEXT DEFAULT 'approved',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(subid, offer_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            pix_key TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Insere oferta padrão se não existir
        db.get("SELECT COUNT(*) as count FROM offers", (err, row) => {
            if (row.count === 0) {
                db.run(`INSERT INTO offers (title, desc, payout, link) VALUES 
                    ('Cadastro Rápido', 'Complete o cadastro e ganhe recompensa', 5.00, 'https://JOINADS-LINK.com?subid=')`);
            }
        });
    });
}

// Middleware de autenticação
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token não fornecido" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Token inválido" });
    }
}

// Anti-fraude: verifica IP duplicado
function checkFraud(subid, ip, offerId) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT COUNT(*) as count FROM clicks WHERE ip_address = ? AND offer_id = ? AND subid != ?",
            [ip, offerId, subid],
            (err, row) => {
                if (err) reject(err);
                resolve(row.count > 0);
            }
        );
    });
}

// ============== ROTAS ==============

// Registro de usuário
app.post("/register", (req, res) => {
    const { name, email, password, pix_key } = req.body;
    const subid = uuidv4();
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    const hashedPassword = password ? bcrypt.hashSync(password, 10) : null;

    db.run(
        `INSERT INTO users (id, name, email, password, subid, pix_key, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), name, email || null, hashedPassword, subid, pix_key || null, ip],
        function(err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed")) {
                    return res.status(400).json({ error: "Email já cadastrado" });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ subid, name, balance: 0 });
        }
    );
});

// Login
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

        if (password && !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: "Senha incorreta" });
        }

        const token = jwt.sign(
            { subid: user.subid, name: user.name },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({ token, subid: user.subid, name: user.name, balance: user.balance });
    });
});

// Redefinir senha
app.post("/reset-password", (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email obrigatório" });
    }

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) {
            // Por segurança, não revelamos se o email existe ou não
            return res.json({ 
                message: "Se este email estiver cadastrado, você receberá uma nova senha em breve." 
            });
        }

        // Gera senha temporária aleatória
        const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
        const hashedPassword = bcrypt.hashSync(tempPassword, 10);

        // Atualiza senha no banco
        db.run(
            "UPDATE users SET password = ? WHERE email = ?",
            [hashedPassword, email],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: "Erro ao redefinir senha" });
                }

                // Em produção, aqui você enviaria um email real
                // Por enquanto, retornamos a senha na resposta (apenas para demonstração)
                console.log(`🔐 Nova senha para ${email}: ${tempPassword}`);

                res.json({ 
                    message: "Senha redefinida com sucesso!",
                    tempPassword: tempPassword, // REMOVER EM PRODUÇÃO - enviar por email
                    note: "Em produção, esta senha seria enviada por email"
                });
            }
        );
    });
});

// Listar ofertas
app.get("/offers", (req, res) => {
    db.all("SELECT * FROM offers WHERE active = 1", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Tracking de clique
app.get("/click/:offerId/:subid", async (req, res) => {
    const { offerId, subid } = req.params;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];

    db.get("SELECT * FROM users WHERE subid = ?", [subid], (err, user) => {
        if (err || !user) return res.status(404).send("Usuário não encontrado");

        db.get("SELECT * FROM offers WHERE id = ?", [offerId], (err, offer) => {
            if (err || !offer) return res.status(404).send("Oferta não encontrada");

            // Salva o clique
            db.run(
                `INSERT INTO clicks (user_id, offer_id, subid, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
                [user.id, offerId, subid, ip, userAgent]
            );

            // Redireciona para a oferta
            const redirectUrl = offer.link + subid;
            res.redirect(redirectUrl);
        });
    });
});

// Postback (conversão)
app.get("/postback", async (req, res) => {
    const { subid, status, offer_id, payout, ip } = req.query;

    if (status !== "approved") return res.send("ignored");

    // Verifica se já existe conversão (anti-duplicação)
    db.get(
        "SELECT * FROM conversions WHERE subid = ? AND offer_id = ?",
        [subid, offer_id],
        (err, existing) => {
            if (err) return res.status(500).send("error");
            if (existing) return res.send("already counted");

            db.get("SELECT * FROM users WHERE subid = ?", [subid], (err, user) => {
                if (err || !user) return res.send("user not found");

                const payoutValue = parseFloat(payout) || 0;

                // Registra conversão
                db.run(
                    `INSERT INTO conversions (subid, offer_id, payout) VALUES (?, ?, ?)`,
                    [subid, offer_id, payoutValue]
                );

                // Atualiza saldo
                db.run(
                    `UPDATE users SET balance = balance + ? WHERE subid = ?`,
                    [payoutValue, subid]
                );

                res.send("ok");
            });
        }
    );
});

// Ver saldo
app.get("/balance/:subid", (req, res) => {
    db.get("SELECT balance, name FROM users WHERE subid = ?", [req.params.subid], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Usuário não encontrado" });
        res.json({ balance: row.balance, name: row.name });
    });
});

// ============== SAQUE PIX ==============

// Solicitar saque
app.post("/withdraw", (req, res) => {
    const { subid, pix_key, amount } = req.body;

    if (!pix_key || !amount || amount <= 0) {
        return res.status(400).json({ error: "Dados inválidos" });
    }

    db.get("SELECT * FROM users WHERE subid = ?", [subid], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "Usuário não encontrado" });

        if (user.balance < amount) {
            return res.status(400).json({ error: "Saldo insuficiente" });
        }

        // Deduz saldo
        db.run(`UPDATE users SET balance = balance - ? WHERE subid = ?`, [amount, subid]);

        // Cria solicitação de saque
        db.run(
            `INSERT INTO withdrawals (user_id, pix_key, amount) VALUES (?, ?, ?)`,
            [user.id, pix_key, amount],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ 
                    message: "Saque solicitado com sucesso", 
                    id: this.lastID,
                    status: "pending",
                    amount 
                });
            }
        );
    });
});

// Histórico de saques
app.get("/withdrawals/:subid", (req, res) => {
    db.get("SELECT id FROM users WHERE subid = ?", [req.params.subid], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "Usuário não encontrado" });

        db.all(
            "SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC",
            [user.id],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows);
            }
        );
    });
});

// ============== ADMIN ==============

// Listar todos usuários
app.get("/admin/users", (req, res) => {
    db.all("SELECT subid, name, email, balance, created_at FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Estatísticas
app.get("/admin/stats", (req, res) => {
    db.get("SELECT COUNT(*) as total_users FROM users", [], (err, users) => {
        db.get("SELECT COUNT(*) as total_clicks FROM clicks", [], (err, clicks) => {
            db.get("SELECT COUNT(*) as total_conversions FROM conversions", [], (err, conversions) => {
                db.get("SELECT SUM(payout) as total_paid FROM conversions", [], (err, paid) => {
                    db.get("SELECT SUM(amount) as pending_withdrawals FROM withdrawals WHERE status = 'pending'", [], (err, pending) => {
                        res.json({
                            users: users.total_users,
                            clicks: clicks.total_clicks,
                            conversions: conversions.total_conversions,
                            total_paid: paid.total_paid || 0,
                            pending_withdrawals: pending.pending_withdrawals || 0
                        });
                    });
                });
            });
        });
    });
});

// Listar saques pendentes
app.get("/admin/withdrawals", (req, res) => {
    db.all(
        `SELECT w.*, u.name, u.email FROM withdrawals w 
         JOIN users u ON w.user_id = u.id 
         WHERE w.status = 'pending' ORDER BY w.created_at DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Aprovar/Rejeitar saque
app.post("/admin/withdrawals/:id", (req, res) => {
    const { status } = req.body; // 'approved' ou 'rejected'

    db.run(
        "UPDATE withdrawals SET status = ? WHERE id = ?",
        [status, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Saque ${status}` });
        }
    );
});

// Adicionar oferta
app.post("/admin/offers", (req, res) => {
    const { title, desc, payout, link } = req.body;

    db.run(
        `INSERT INTO offers (title, desc, payout, link) VALUES (?, ?, ?, ?)`,
        [title, desc, payout, link],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, title, desc, payout, link });
        }
    );
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     CPA Hub Pro v2.0 - Ativo!          ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  ➜  Local:   http://localhost:${PORT}       ║`);
    console.log(`║  ➜  Rede:    http://0.0.0.0:${PORT}         ║`);
    console.log('╚════════════════════════════════════════╝');
});
