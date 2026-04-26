import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const payload = await req.json();
    const record  = payload.record;

    const { name, email, school, subject, message } = record;

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="margin:0 0 20px;font-size:20px">New Contact Form Submission</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600;width:120px">Name</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee">${name}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">Email</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">School</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee">${school || "—"}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">Subject</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee">${subject || "—"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;vertical-align:top">Message</td>
              <td style="padding:8px 0;white-space:pre-wrap">${message}</td></tr>
        </table>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "Beyond the Portal <onboarding@resend.dev>",
        to:      ["beyondtheportalbasketball@gmail.com"],
        subject: `Contact Form: ${name} (${email})`,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.ok ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
