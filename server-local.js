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

// SQLite3 para desenvolvimento local
const db = new sqlite3.Database("./cpahub.db");
console.log("SQLite3 conectado com sucesso!");

const JWT_SECRET = process.env.JWT_SECRET || "cpahub-secret-key";

function initDB() {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        subid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        pix_key TEXT NOT NULL,
        balance REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Offers table
    db.run(`
      CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        payout REAL NOT NULL,
        url TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Clicks table
    db.run(`
      CREATE TABLE IF NOT EXISTS clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subid TEXT NOT NULL,
        offer_id INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subid) REFERENCES users(subid),
        FOREIGN KEY (offer_id) REFERENCES offers(id)
      )
    `);

    // Conversions table
    db.run(`
      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subid TEXT NOT NULL,
        offer_id INTEGER NOT NULL,
        payout REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subid) REFERENCES users(subid),
        FOREIGN KEY (offer_id) REFERENCES offers(id)
      )
    `);

    // Withdrawals table
    db.run(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subid TEXT NOT NULL,
        amount REAL NOT NULL,
        pix_key TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME,
        FOREIGN KEY (subid) REFERENCES users(subid)
      )
    `);

    // Insert sample offers
    db.get("SELECT COUNT(*) as count FROM offers", (err, row) => {
      if (!err && row.count === 0) {
        const offers = [
          ['Cadastro App', 'Baixe e cadastre-se no aplicativo', 15.00, 'https://example.com/app'],
          ['Newsletter', 'Inscreva-se na newsletter', 2.50, 'https://example.com/newsletter'],
          ['Survey Premium', 'Complete pesquisa premium', 8.00, 'https://example.com/survey'],
          ['Game Download', 'Baixe e jogue por 10 minutos', 12.00, 'https://example.com/game']
        ];

        offers.forEach(offer => {
          db.run("INSERT INTO offers (name, description, payout, url) VALUES (?, ?, ?, ?)", offer);
        });
        console.log("Ofertas de exemplo inseridas!");
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
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Registrar usuário
app.post("/register", (req, res) => {
  const { name, email, password, pix_key } = req.body;

  if (!name || !email || !password || !pix_key) {
    return res.status(400).json({ error: "Preencha todos os campos" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) return res.status(400).json({ error: "Email já cadastrado" });

    const subid = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run(
      "INSERT INTO users (subid, name, email, password, pix_key) VALUES (?, ?, ?, ?, ?)",
      [subid, name, email, hashedPassword, pix_key],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ subid, name, balance: 0 });
      }
    );
  });
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    if (!bcrypt.compareSync(password, user.password)) {
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
      return res.json({ 
        message: "Se este email estiver cadastrado, você receberá uma nova senha em breve." 
      });
    }

    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    const hashedPassword = bcrypt.hashSync(tempPassword, 10);

    db.run("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], function(err) {
      if (err) return res.status(500).json({ error: "Erro ao redefinir senha" });

      console.log(`Nova senha para ${email}: ${tempPassword}`);

      res.json({ 
        message: "Senha redefinida com sucesso!",
        tempPassword: tempPassword,
        note: "Em produção, esta senha seria enviada por email"
      });
    });
  });
});

// Listar ofertas
app.get("/offers", (req, res) => {
  db.all("SELECT * FROM offers WHERE active = 1 ORDER BY payout DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tracking de clique
app.get("/click/:offerId/:subid", (req, res) => {
  const { offerId, subid } = req.params;
  const ip = req.ip;
  const userAgent = req.get('User-Agent');

  db.run(
    "INSERT INTO clicks (subid, offer_id, ip_address, user_agent) VALUES (?, ?, ?, ?)",
    [subid, offerId, ip, userAgent],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      db.get("SELECT url FROM offers WHERE id = ?", [offerId], (err, offer) => {
        if (err) return res.status(500).json({ error: err.message });
        if (offer) {
          res.redirect(offer.url);
        } else {
          res.status(404).send("Oferta não encontrada");
        }
      });
    }
  );
});

// Postback de conversão
app.post("/postback", (req, res) => {
  const { subid, offer_id, payout, status = 'approved' } = req.body;

  db.get("SELECT * FROM conversions WHERE subid = ? AND offer_id = ?", [subid, offer_id], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!existing) {
      db.run(
        "INSERT INTO conversions (subid, offer_id, payout, status) VALUES (?, ?, ?, ?)",
        [subid, offer_id, payout, status],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });

          if (status === 'approved') {
            db.run("UPDATE users SET balance = balance + ? WHERE subid = ?", [payout, subid]);
          }
        }
      );
    }

    res.json({ success: true });
  });
});

// Dashboard do usuário
app.get("/dashboard", authMiddleware, (req, res) => {
  const { subid } = req.user;

  db.get("SELECT * FROM users WHERE subid = ?", [subid], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all("SELECT * FROM conversions WHERE subid = ? ORDER BY created_at DESC LIMIT 10", [subid], (err, conversions) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all("SELECT * FROM withdrawals WHERE subid = ? ORDER BY created_at DESC LIMIT 10", [subid], (err, withdrawals) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          user: {
            name: user.name,
            balance: user.balance,
            pix_key: user.pix_key
          },
          conversions,
          withdrawals
        });
      });
    });
  });
});

// Solicitar saque
app.post("/withdraw", authMiddleware, (req, res) => {
  const { subid } = req.user;
  const { amount, pix_key } = req.body;

  db.get("SELECT * FROM users WHERE subid = ?", [subid], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });

    if (user.balance < amount) {
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    if (amount < 10) {
      return res.status(400).json({ error: "Valor mínimo para saque é R$ 10,00" });
    }

    db.run(
      "INSERT INTO withdrawals (subid, amount, pix_key) VALUES (?, ?, ?)",
      [subid, amount, pix_key || user.pix_key],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Saque solicitado com sucesso!" });
      }
    );
  });
});

// Admin Panel
app.get("/admin/stats", (req, res) => {
  db.get("SELECT COUNT(*) as total FROM users", [], (err, users) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT COUNT(*) as total FROM offers", [], (err, offers) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get("SELECT COUNT(*) as total, COALESCE(SUM(payout), 0) as total_payout FROM conversions", [], (err, conversions) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT COUNT(*) as total, COALESCE(SUM(amount), 0) as total_amount FROM withdrawals WHERE status = 'approved'", [], (err, withdrawals) => {
          if (err) return res.status(500).json({ error: err.message });

          res.json({
            users: users.total,
            offers: offers.total,
            conversions: conversions.total,
            totalPayout: conversions.total_payout,
            withdrawals: withdrawals.total,
            totalWithdrawn: withdrawals.total_amount
          });
        });
      });
    });
  });
});

// Adicionar oferta
app.post("/admin/offers", (req, res) => {
  const { name, description, payout, url } = req.body;

  db.run(
    "INSERT INTO offers (name, description, payout, url) VALUES (?, ?, ?, ?)",
    [name, description, payout, url],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: "Oferta adicionada com sucesso!" });
    }
  );
});

// Listar saques pendentes
app.get("/admin/withdrawals", (req, res) => {
  db.all(`
    SELECT w.*, u.name, u.email 
    FROM withdrawals w 
    JOIN users u ON w.subid = u.subid 
    WHERE w.status = 'pending' 
    ORDER BY w.created_at DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Aprovar/rejeitar saque
app.post("/admin/withdrawals/:id/process", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  db.get("SELECT * FROM withdrawals WHERE id = ?", [id], (err, withdrawal) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!withdrawal) return res.status(404).json({ error: "Saque não encontrado" });

    db.run("UPDATE withdrawals SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?", [status, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      if (status === 'approved') {
        db.run("UPDATE users SET balance = balance - ? WHERE subid = ?", [withdrawal.amount, withdrawal.subid]);
      }

      res.json({ success: true, message: `Saque ${status === 'approved' ? 'aprovado' : 'rejeitado'} com sucesso!` });
    });
  });
});

// Inicializar e iniciar servidor
initDB();

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('CPA Hub Pro v2.0 - SQLite3 Edition!');
  console.log(`Local:   http://localhost:${PORT}`);
  console.log(`Rede:    http://0.0.0.0:${PORT}`);
  console.log('Banco: SQLite3 (desenvolvimento)');
});
