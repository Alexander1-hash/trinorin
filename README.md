# trinorin
AI-powered cybersecurity intelligence for modern businesses.
Trinorin is a cybersecurity intelligence platform designed to help businesses discover, understand, monitor, and respond to security risks.

The goal is simple:

> Don't wait until the company gets hacked.

Trinorin will continuously help organizations understand their security posture and turn technical security findings into clear, actionable recommendations.

---

## Vision

Build an intelligent cybersecurity layer that helps businesses identify security risks before they become serious incidents.

Trinorin is designed to combine:

- Security inspection
- Asset visibility
- Vulnerability intelligence
- Threat detection
- AI-assisted security analysis
- Security alerts
- Security reporting
- Automated security workflows

---

## Core Product

### Security Inspector

The first major Trinorin capability.

A business will be able to connect an authorized website, domain, or asset and run security checks against it.

Trinorin will:

1. Discover authorized security information
2. Perform appropriate security checks
3. Identify potential security issues
4. Classify findings by severity
5. Explain findings in understandable language
6. Recommend remediation steps
7. Track whether issues have been addressed
8. Generate security reports

All security testing must be performed only against systems that the customer owns or has explicitly authorized Trinorin to assess.

---

## Product Architecture

```text
Trinorin
│
├── Security Dashboard
├── Security Inspector
├── Asset Intelligence
├── Vulnerability Intelligence
├── Threat Detection
├── AI Security Analyst
├── Security Alerts
├── Security Reports
└── Trinorin API


## Provider-backed response execution

Trinorin now supports an explicit provider execution adapter through HTTPS webhooks.

Required deployment environment variables:

- `TRINORIN_EXECUTOR_WEBHOOK_SECRET` — signing secret shared with the provider executor.
- `TRINORIN_EXECUTOR_WEBHOOK_HOSTS` — comma-separated exact hostnames allowed to receive execution requests.

For a connected integration, use **Integrations → Configure provider executor** and provide the provider's HTTPS execution endpoint. Trinorin sends a signed `security_action.execute` request only after the security action is approved and explicitly operator-authorized. The provider response is recorded as an execution outcome and still requires post-response verification.

The provider endpoint should validate:

- `x-trinorin-signature` using HMAC-SHA256 over the exact JSON request body.
- `x-trinorin-action-id` and the organization-scoped target.
- The action type and provider-specific authorization on the provider side.

The executor does not treat connectivity as authorization and does not infer successful remediation from missing telemetry.

## Vercel build-rate resilience

Trinorin includes `.github/workflows/trinorin-ci.yml`, which validates TypeScript and the production build in GitHub Actions and deploys the resulting Vercel prebuilt artifact. Configure the repository secret `VERCEL_TOKEN` before enabling the deployment job. This separates application builds from Vercel's remote Git build queue.


## Digital Footprint Intelligence — public web discovery

The signed-in **/footprint** page supports two user-initiated workflows:
- Public-web discovery via Brave Search API.
- Text matching against up to five public HTML pages supplied by the user.

Configure the server-side environment variable `BRAVE_SEARCH_API_KEY` with a valid Brave Search API subscription key to enable automated public-web discovery. Do not expose this key in a `NEXT_PUBLIC_*` variable or client code. Without it, the discovery endpoint returns a clear configuration message rather than pretending a search occurred.

Search results are unverified leads. They are not proof of identity or ownership and do not represent complete internet coverage. The current implementation does not sign in to social accounts, persist a footprint case, request takedowns, or delete content. Those workflows require separate platform-approved authorization, evidence retention, explicit user confirmation, and post-action verification.
