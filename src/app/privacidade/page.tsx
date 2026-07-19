export const metadata = {
  title: 'Política de Privacidade — FunilPro',
  description: 'Política de privacidade da plataforma FunilPro.',
}

export default function PrivacidadePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-gray-800" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
      <p className="text-sm text-gray-500 mb-8">FunilPro — Última atualização: 19 de julho de 2026</p>

      <section className="flex flex-col gap-6 text-[15px] leading-relaxed">
        <div>
          <h2 className="text-xl font-semibold mb-2">1. Quem somos</h2>
          <p>
            O FunilPro é uma plataforma de automação de marketing e vendas operada por LC Marketing Digital
            (&quot;nós&quot;). Esta política explica como coletamos, usamos e protegemos dados pessoais ao fornecer
            nossos serviços, incluindo integrações com WhatsApp, Instagram e e-mail.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">2. Dados que coletamos</h2>
          <p className="mb-2">Coletamos apenas o necessário para operar o serviço:</p>
          <ul className="list-disc list-inside flex flex-col gap-1">
            <li><strong>Dados de conta:</strong> nome, e-mail e informações de acesso de usuários da plataforma.</li>
            <li><strong>Dados de leads:</strong> nome, telefone, e-mail e mensagens trocadas em conversas iniciadas pelo próprio lead (WhatsApp, Instagram Direct, comentários e chat do site).</li>
            <li><strong>Dados do Instagram:</strong> quando um usuário conecta sua conta profissional, acessamos identificador da conta, nome de usuário, mídia publicada, comentários e mensagens diretas — exclusivamente para executar as automações configuradas pelo próprio usuário.</li>
            <li><strong>Dados de uso:</strong> métricas de funis, páginas e conversas para exibição de relatórios ao próprio usuário.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">3. Como usamos os dados</h2>
          <ul className="list-disc list-inside flex flex-col gap-1">
            <li>Executar automações configuradas pelo usuário (responder mensagens, comentários e enviar sequências).</li>
            <li>Exibir métricas e histórico de conversas ao dono da conta.</li>
            <li>Enviar lembretes e notificações relacionados a agendamentos feitos pelo lead.</li>
            <li>Melhorar a qualidade e a segurança do serviço.</li>
          </ul>
          <p className="mt-2">
            <strong>Não vendemos dados pessoais</strong> e não os usamos para publicidade própria. Mensagens são
            processadas por provedores de inteligência artificial apenas para gerar respostas às conversas.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">4. Compartilhamento</h2>
          <p>
            Compartilhamos dados apenas com operadores essenciais ao funcionamento do serviço: hospedagem
            (Vercel), banco de dados (Supabase), envio de e-mail (Resend), APIs da Meta (WhatsApp/Instagram) e
            provedores de IA (Anthropic/OpenAI) — todos sujeitos a obrigações de confidencialidade. Podemos
            divulgar dados quando exigido por lei.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">5. Retenção e segurança</h2>
          <p>
            Mantemos os dados enquanto a conta estiver ativa ou conforme necessário para cumprir obrigações
            legais. Usamos criptografia em trânsito (HTTPS), isolamento por cliente (multi-tenant com controle de
            acesso em nível de linha) e credenciais protegidas.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">6. Seus direitos (LGPD)</h2>
          <p>
            Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar acesso,
            correção, portabilidade ou exclusão dos seus dados pessoais, bem como revogar consentimentos.
            Para exercer esses direitos, escreva para o contato abaixo.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">7. Exclusão de dados</h2>
          <p>
            Para solicitar a exclusão dos seus dados (incluindo dados obtidos via Instagram ou WhatsApp), envie
            um e-mail para <a href="mailto:luisverbo@gmail.com" className="text-indigo-600 underline">luisverbo@gmail.com</a> com
            o assunto &quot;Exclusão de dados&quot;. Atenderemos em até 15 dias, removendo os dados pessoais
            associados, salvo obrigação legal de retenção.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">8. Contato</h2>
          <p>
            Dúvidas sobre esta política: <a href="mailto:luisverbo@gmail.com" className="text-indigo-600 underline">luisverbo@gmail.com</a>.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">9. Alterações</h2>
          <p>
            Podemos atualizar esta política periodicamente. A versão vigente estará sempre disponível nesta
            página, com a data da última atualização no topo.
          </p>
        </div>
      </section>
    </main>
  )
}
