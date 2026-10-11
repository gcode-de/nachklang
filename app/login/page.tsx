import LoginForm from "./login-form";
export const dynamic = "force-dynamic";
export default function Login() {
  return (
    <>
    {process.env.ALLOW_REGISTRATION === "false" && <section className="narrow"><p className="notice">Private Instanz · Anmeldung nur mit bestehendem Konto. Keine öffentliche Registrierung. {process.env.OPERATOR_CONTACT ? `Zugangsanfragen: ${process.env.OPERATOR_CONTACT}` : "Ein Kontakt für Zugangsanfragen ist nicht hinterlegt."}</p></section>}
    <LoginForm
      registrationEnabled={process.env.ALLOW_REGISTRATION !== "false"}
    />
    </>
  );
}
