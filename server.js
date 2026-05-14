const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/cpahub",
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || "cpahub-secret-key";

async function initDB() {
  try {
    console.log("Conectando ao PostgreSQL...");
    
    // Criar tabelas se não existirem
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        subid VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        pix_key VARCHAR(255) NOT NULL,
        balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        payout DECIMAL(10,2) NOT NULL,
        url VARCHAR(500) NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS clicks (
        id SERIAL PRIMARY KEY,
        subid VARCHAR(36) NOT NULL,
        offer_id INTEGER NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subid) REFERENCES users(subid),
        FOREIGN KEY (offer_id) REFERENCES offers(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversions (
        id SERIAL PRIMARY KEY,
        subid VARCHAR(36) NOT NULL,
        offer_id INTEGER NOT NULL,
        payout DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subid) REFERENCES users(subid),
        FOREIGN KEY (offer_id) REFERENCES offers(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        subid VARCHAR(36) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        pix_key VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        FOREIGN KEY (subid) REFERENCES users(subid)
      )
    `);

    console.log("PostgreSQL conectado com sucesso!");
    
    // Inserir ofertas de exemplo
    const offersCount = await pool.query("SELECT COUNT(*) FROM offers");
    if (offersCount.rows[0].count === '0') {
      await pool.query(`
        INSERT INTO offers (name, description, payout, url) VALUES
        ('Cadastro App', 'Baixe e cadastre-se no aplicativo', 7.50, 'https://example.com/app'),
        ('Newsletter', 'Inscreva-se na newsletter', 1.25, 'https://example.com/newsletter'),
        ('Survey Premium', 'Complete pesquisa premium', 4.00, 'https://example.com/survey'),
        ('Game Download', 'Baixe e jogue por 10 minutos', 6.00, 'https://example.com/game')
      `);
      console.log("Ofertas de exemplo inseridas!");
    }
    
  } catch (error) {
    console.error("Erro ao inicializar banco:", error);
  }
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
app.post("/register", async (req, res) => {
  const { name, email, password, pix_key } = req.body;

  if (!name || !email || !password || !pix_key) {
    return res.status(400).json({ error: "Preencha todos os campos" });
  }

  try {
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    const subid = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);

    await pool.query(
      "INSERT INTO users (subid, name, email, password, pix_key) VALUES ($1, $2, $3, $4, $5)",
      [subid, name, email, hashedPassword, pix_key]
    );

    res.json({ subid, name, balance: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    const token = jwt.sign(
      { subid: user.subid, name: user.name },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, subid: user.subid, name: user.name, balance: user.balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Redefinir senha
app.post("/reset-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email obrigatório" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];

    if (!user) {
      return res.json({ 
        message: "Se este email estiver cadastrado, você receberá uma nova senha em breve." 
      });
    }

    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    const hashedPassword = bcrypt.hashSync(tempPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);

    console.log(`Nova senha para ${email}: ${tempPassword}`);

    res.json({ 
      message: "Senha redefinida com sucesso!",
      tempPassword: tempPassword,
      note: "Em produção, esta senha seria enviada por email"
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
});

// Listar ofertas
app.get("/offers", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM offers WHERE active = true ORDER BY payout DESC");
    const offers = result.rows.map(o => ({ ...o, payout: Number(o.payout) }));
    res.json(offers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Saldo do usuário (sem auth, só pelo subid)
app.get("/balance/:subid", async (req, res) => {
  try {
    const result = await pool.query("SELECT balance FROM users WHERE subid = $1", [req.params.subid]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json({ balance: Number(result.rows[0].balance) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico de saques do usuário
app.get("/withdrawals/:subid", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM withdrawals WHERE subid = $1 ORDER BY created_at DESC",
      [req.params.subid]
    );
    const rows = result.rows.map(w => ({ ...w, amount: Number(w.amount) }));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tracking de clique
app.get("/click/:offerId/:subid", async (req, res) => {
  const { offerId, subid } = req.params;
  const ip = req.ip;
  const userAgent = req.get('User-Agent');

  try {
    await pool.query(
      "INSERT INTO clicks (subid, offer_id, ip_address, user_agent) VALUES ($1, $2, $3, $4)",
      [subid, offerId, ip, userAgent]
    );

    const offer = await pool.query("SELECT url FROM offers WHERE id = $1", [offerId]);
    if (offer.rows.length > 0) {
      res.redirect(offer.rows[0].url);
    } else {
      res.status(404).send("Oferta não encontrada");
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Postback de conversão
app.post("/postback", async (req, res) => {
  const { subid, offer_id, payout, status = 'approved' } = req.body;

  try {
    // Verificar se já existe conversão
    const existing = await pool.query(
      "SELECT * FROM conversions WHERE subid = $1 AND offer_id = $2",
      [subid, offer_id]
    );

    if (existing.rows.length === 0) {
      // Adicionar conversão
      await pool.query(
        "INSERT INTO conversions (subid, offer_id, payout, status) VALUES ($1, $2, $3, $4)",
        [subid, offer_id, payout, status]
      );

      // Atualizar saldo do usuário se aprovado
      if (status === 'approved') {
        await pool.query(
          "UPDATE users SET balance = balance + $1 WHERE subid = $2",
          [payout, subid]
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard do usuário
app.get("/dashboard", authMiddleware, async (req, res) => {
  const { subid } = req.user;

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE subid = $1", [subid]);
    const user = userResult.rows[0];

    const conversionsResult = await pool.query(
      "SELECT * FROM conversions WHERE subid = $1 ORDER BY created_at DESC LIMIT 10",
      [subid]
    );

    const withdrawalsResult = await pool.query(
      "SELECT * FROM withdrawals WHERE subid = $1 ORDER BY created_at DESC LIMIT 10",
      [subid]
    );

    res.json({
      user: {
        name: user.name,
        balance: user.balance,
        pix_key: user.pix_key
      },
      conversions: conversionsResult.rows,
      withdrawals: withdrawalsResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Solicitar saque (aceita subid no body, sem necessidade de token)
app.post("/withdraw", async (req, res) => {
  const { subid, amount, pix_key } = req.body;

  if (!subid || !amount) {
    return res.status(400).json({ error: "subid e amount são obrigatórios" });
  }

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE subid = $1", [subid]);
    const user = userResult.rows[0];

    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    if (Number(user.balance) < Number(amount)) {
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    if (Number(amount) < 10) {
      return res.status(400).json({ error: "Valor mínimo para saque é R$ 10,00" });
    }

    await pool.query(
      "INSERT INTO withdrawals (subid, amount, pix_key) VALUES ($1, $2, $3)",
      [subid, amount, pix_key || user.pix_key]
    );

    res.json({ success: true, message: "Saque solicitado com sucesso!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Panel
app.get("/admin/stats", async (req, res) => {
  try {
    const users = await pool.query("SELECT COUNT(*) as total FROM users");
    const clicks = await pool.query("SELECT COUNT(*) as total FROM clicks");
    const conversions = await pool.query("SELECT COUNT(*) as total, COALESCE(SUM(payout), 0) as total_earned FROM conversions WHERE status = 'approved'");
    const paid = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'approved'");
    const pending = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'pending'");
    const userBalance = await pool.query("SELECT COALESCE(SUM(balance), 0) as total FROM users");

    res.json({
      users: Number(users.rows[0].total),
      clicks: Number(clicks.rows[0].total),
      conversions: Number(conversions.rows[0].total),
      total_earned: Number(conversions.rows[0].total_earned), // quanto usuários já ganharam (conv. aprovadas)
      total_paid: Number(paid.rows[0].total),               // quanto a plataforma já pagou via saque
      pending_withdrawals: Number(pending.rows[0].total),   // saques pendentes
      user_balance_total: Number(userBalance.rows[0].total) // saldo acumulado a pagar
    });
  } catch (error) {
    console.error('admin/stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listar ofertas (admin vê todas, incluindo inativas)
app.get("/admin/offers", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM offers ORDER BY created_at DESC");
    const offers = result.rows.map(o => ({ ...o, payout: Number(o.payout) }));
    res.json(offers);
  } catch (error) {
    console.error('admin/offers GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remover oferta
app.delete("/admin/offers/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM offers WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar usuários
app.get("/admin/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT subid, name, email, balance, created_at FROM users ORDER BY created_at DESC"
    );
    const users = result.rows.map(u => ({ ...u, balance: Number(u.balance) }));
    res.json(users);
  } catch (error) {
    console.error('admin/users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Adicionar oferta (aceita tanto {name,description,url} quanto {title,desc,link})
app.post("/admin/offers", async (req, res) => {
  const { name, title, description, desc, payout, url, link } = req.body;
  const offerName = name || title;
  const offerDesc = description || desc;
  const offerUrl = url || link;

  if (!offerName || !offerDesc || payout == null || !offerUrl) {
    return res.status(400).json({ error: "Preencha todos os campos" });
  }

  try {
    await pool.query(
      "INSERT INTO offers (name, description, payout, url) VALUES ($1, $2, $3, $4)",
      [offerName, offerDesc, payout, offerUrl]
    );

    res.json({ success: true, message: "Oferta adicionada com sucesso!" });
  } catch (error) {
    console.error('admin/offers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listar saques pendentes
app.get("/admin/withdrawals", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, u.name, u.email, u.pix_key AS user_pix_key
      FROM withdrawals w 
      JOIN users u ON w.subid = u.subid 
      WHERE w.status = 'pending' 
      ORDER BY w.created_at DESC
    `);
    const withdrawals = result.rows.map(w => ({ ...w, amount: Number(w.amount) }));
    res.json(withdrawals);
  } catch (error) {
    console.error('admin/withdrawals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Aprovar/rejeitar saque
app.post("/admin/withdrawals/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'approved' ou 'rejected'

  try {
    const withdrawalResult = await pool.query("SELECT * FROM withdrawals WHERE id = $1", [id]);
    const withdrawal = withdrawalResult.rows[0];

    if (!withdrawal) {
      return res.status(404).json({ error: "Saque não encontrado" });
    }

    await pool.query(
      "UPDATE withdrawals SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2",
      [status, id]
    );

    if (status === 'approved') {
      await pool.query(
        "UPDATE users SET balance = balance - $1 WHERE subid = $2",
        [withdrawal.amount, withdrawal.subid]
      );
    }

    res.json({ success: true, message: `Saque ${status === 'approved' ? 'aprovado' : 'rejeitado'} com sucesso!` });
  } catch (error) {
    console.error('admin/withdrawals/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Inicializar e iniciar servidor
initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('CPA Hub Pro v2.0 - PostgreSQL Edition!');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Rede:    http://0.0.0.0:${PORT}`);
    console.log('Banco: PostgreSQL');
  });
});
