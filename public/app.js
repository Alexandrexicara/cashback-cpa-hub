function loadDashboard() {
    const subid = localStorage.getItem("subid");
    const username = localStorage.getItem("username");

    document.getElementById("username").textContent = `Olá, ${username}`;

    // Carrega saldo
    fetch(`/balance/${subid}`)
        .then(r => r.json())
        .then(data => {
            const balance = data.balance || 0;
            document.getElementById("balance").textContent = balance.toFixed(2);
            document.getElementById("modal-balance").textContent = balance.toFixed(2);
        })
        .catch(err => {
            console.error("Erro ao carregar saldo:", err);
        });

    // Carrega ofertas
    fetch("/offers")
        .then(r => r.json())
        .then(data => {
            const div = document.getElementById("offers");
            
            if (data.length === 0) {
                div.innerHTML = "<p>Nenhuma oferta disponível no momento.</p>";
                return;
            }

            div.innerHTML = data.map(o => `
                <div class="offer-card">
                    <h3>${o.title}</h3>
                    <p>${o.desc}</p>
                    <div class="offer-footer">
                        <span class="payout">R$ ${o.payout.toFixed(2)}</span>
                        <a href="/click/${o.id}/${subid}" class="btn-participate">
                            Participar
                        </a>
                    </div>
                </div>
            `).join("");
        })
        .catch(err => {
            console.error("Erro ao carregar ofertas:", err);
        });
}

function loadWithdrawals() {
    const subid = localStorage.getItem("subid");
    
    fetch(`/withdrawals/${subid}`)
        .then(r => r.json())
        .then(data => {
            const div = document.getElementById("withdrawals");
            
            if (!data || data.length === 0) {
                div.innerHTML = "<p class='no-data'>Nenhum saque realizado ainda.</p>";
                return;
            }

            div.innerHTML = data.map(w => `
                <div class="withdrawal-item ${w.status}">
                    <span class="withdrawal-amount">R$ ${w.amount.toFixed(2)}</span>
                    <span class="withdrawal-status ${w.status}">${w.status === 'pending' ? '⏳ Pendente' : w.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'}</span>
                    <span class="withdrawal-date">${new Date(w.created_at).toLocaleDateString()}</span>
                </div>
            `).join("");
        })
        .catch(err => {
            console.error("Erro ao carregar saques:", err);
        });
}

function openWithdrawModal() {
    document.getElementById("withdraw-modal").style.display = "block";
    const subid = localStorage.getItem("subid");
    fetch(`/balance/${subid}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById("modal-balance").textContent = (data.balance || 0).toFixed(2);
        });
}

function closeWithdrawModal() {
    document.getElementById("withdraw-modal").style.display = "none";
}

function requestWithdraw() {
    const subid = localStorage.getItem("subid");
    const pix_key = document.getElementById("withdraw-pix").value;
    const amount = parseFloat(document.getElementById("withdraw-amount").value);

    if (!pix_key || !amount || amount < 10) {
        alert("Preencha todos os campos. Mínimo: R$ 10,00");
        return;
    }

    fetch("/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subid, pix_key, amount })
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
            return;
        }
        alert("Saque solicitado com sucesso! Aguarde aprovação.");
        closeWithdrawModal();
        loadDashboard();
        loadWithdrawals();
    })
    .catch(err => {
        alert("Erro ao solicitar saque. Tente novamente.");
    });
}

function logout() {
    localStorage.removeItem("subid");
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    window.location = "/login.html";
}

// Fechar modal ao clicar fora
window.onclick = function(event) {
    const modal = document.getElementById("withdraw-modal");
    if (event.target === modal) {
        modal.style.display = "none";
    }
}
