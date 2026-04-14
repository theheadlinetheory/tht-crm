# LeadHero.io API Endpoints - Complete Reference

**Base URL:** `https://api.leadhero.io`
**App URL:** `https://app.leadhero.io`

---

## Authentication

### Security Schemes
| Scheme | Type | Details |
|--------|------|---------|
| Session Cookie | Cookie | `session` cookie (used by web app) |
| Bearer Token | Header | `Authorization: Bearer YOUR_API_KEY` |
| API Key Header | Header | `x-api-key: YOUR_API_KEY` |

### Google OAuth
- **Client ID:** `499723084135-lvptau7ee8jbebbo7stulfq72i9vk0el.apps.googleusercontent.com`
- All fetch requests use `credentials: "include"` for cookie-based session handling

---

## 1. User Authentication & Profile

### POST /users/auth/magic-code/login
**Send magic login code**
- **Request Body:** `{ email: string }`

### GET /users/auth/magic-code/callback
**Verify magic login code**
- **Query Params:** `code` (number), `email` (string, URL-encoded)

### POST /users/auth/login
**Login with password**
- **Request Body:** `{ email: string, password: string }`

### POST /users/auth/google/callback
**Google OAuth callback**
- **Request Body:** Google credential object

### POST /users/logout
**Logout current session**

### GET /users/
**Get current authenticated user**
- **Response:** User object with `name`, `email`, `profilePicture`, `settings`

### PUT /users
**Update user profile**
- **Request Body:** `UpdateUserPayload` (name, email, etc.)

### PUT /users/passwords
**Update password**
- **Request Body:** `{ password: string, confirmPassword: string, existingPassword: string }`

### PUT /users/profile-picture
**Update profile picture** (multipart)
- **Request Body:** File/Blob (JPG, GIF, PNG, max 1MB)

---

## 2. Organizations

### POST /organizations
**Create new organization**
- **Request Body:** `{ id: string, profile: { name: string, description?: string } }`

### GET /organizations/quicklist
**Get user's organization list**
- **Response:** Array of `{ id, name, role }`

### GET /organizations/{organization}
**Get organization details**
- **Response:** Organization object with members array, billing settings, Telnyx config

### GET /organizations/preview/{organization}
**Get organization preview data**

### GET /organizations/websocket/token
**Get WebSocket authentication token**

---

## 3. Organization Settings & Billing

### PUT /organizations/{organization}/settings (inferred)
**Update organization settings**
- **Request Body:** `{ org: string, settings: { [key]: value } }`

### PUT /organizations/{organization}/billing-settings (inferred)
**Update billing settings**
- **Request Body:** Includes `monthlySpendingLimit`, `topups.enabled`, `topups.treshold`, `topups.amount`, address, name

### GET /stripe/products
**Get available subscription plans**
- **Query Params:** `type=recurring`
- **Response:** Array of Plan objects with `id`, `name`, `description`, `default_price`, `metadata`

### POST /stripe/setup-intent (inferred: createSetupIntent)
**Create Stripe setup intent for payment methods**
- **Response:** `{ clientSecret: string }`

### POST /stripe/payment-intent/add-to-balance (inferred: createPaymentIntentAddToBalance)
**Create payment intent for adding balance**
- **Request Body:** `{ org: string, amount: number }` (min $10)

### GET /stripe/invoices-and-payment-intents (inferred: getInvoicesAndPaymentIntents)
**Get billing history**
- **Query Params:** `org` (organization ID)
- **Response:** Invoice objects with `status`, `created`, `amount_remaining`, `amount_paid`, `hosted_invoice_url`, `invoice_pdf`; PaymentIntent objects with `status`, `created`, `amount`, `description`

### GET /stripe/payment-methods (inferred: getPaymentMethods)
**Get saved payment methods**
- **Response:** Array of `{ id, card: { brand, last4, exp_month, exp_year }, primary: boolean }`

### PUT /stripe/payment-methods (inferred: updatePaymentMethod)
**Update payment method**

### DELETE /stripe/payment-methods (inferred: deletePaymentMethod)
**Delete payment method**

### POST /stripe/subscription (inferred: updateSubscription)
**Create/update subscription**
- **Request Body:** `{ org: string, seats: number }`
- **Response:** Subscription with `status`, `plan`, `items`, `trial_end`, `cancel_at_period_end`

### GET /stripe/subscription (inferred: getSubscription)
**Get current subscription**
- **Response:** `{ status: "trialing"|"active"|"canceled", plan: { name, features: { seats } }, items, trial_end, cancel_at, cancel_at_period_end }`

---

## 4. Organization Members & Invites

### GET /organizations/{organization}/members (from OpenAPI route group)
**List organization members**

### GET /organizations/{organization}/invites (from OpenAPI route group)
**List organization invites**

---

## 5. Usage & Analytics

### GET /analytics/{organization}
**Get analytics data**
- **Query Params:** `from` (YYYY-MM-DD), `to` (YYYY-MM-DD)
- **Response:**
```json
{
  "data": {
    "overview": {
      "totals": {
        "calls": 0, "answered": 0, "missed": 0,
        "duration": 0, "cost": 0, "bookings": 0, "bookingAmount": 0
      },
      "callsByAgent": [{"label": "", "value": 0}],
      "callsByFolder": [{"label": "", "value": 0}],
      "callOutcomeBreakdown": [{"label": "", "value": 0}],
      "directionBreakdown": [{"label": "", "value": 0}],
      "humanPickupBreakdown": [{"label": "", "value": 0}],
      "callsOverTime": [{
        "date": "", "calls": 0, "duration": 0,
        "humanPickups": 0, "machinePickups": 0, "notSure": 0,
        "missed": 0, "bookings": 0, "bookingAmount": 0
      }]
    },
    "agents": [{
      "agentId": "", "totals": {},
      "callOutcomeBreakdown": [], "directionBreakdown": [],
      "humanPickupBreakdown": [], "callsOverTime": []
    }],
    "leadFolders": [{
      "folderId": "", "folderName": "", "totals": {},
      "callOutcomeBreakdown": [], "directionBreakdown": [],
      "humanPickupBreakdown": [], "agentContribution": [], "callsOverTime": []
    }]
  }
}
```

### GET /usage/{organization} (inferred: getUsage)
**Get usage/billing metrics**
- **Query Params:** `from` (date), `to` (date)
- **Response:** `{ usage[], breakdown[], total: { totalCost, calls, phoneNumbers, enrichments, transcriptions, other }, seats }`

---

## 6. Leads

### POST /leads/{organization}
**Create a new lead**
- **Request Body:**
```json
{
  "primaryPhone": "string",
  "name": "string",
  "status": "cold|warm|called|called-back|answered|booked|dnc",
  "email": "string",
  "secondaryPhone": "string|null",
  "website": "string",
  "company": { "name": "string", "industry": "string" },
  "note": "string",
  "profilePicture": "string (URI)",
  "jobTitle": "string",
  "location": "string",
  "linkedinUrl": "string",
  "domain": "string",
  "industry": "string",
  "revenueRange": "string",
  "companySize": "string",
  "potential": "string",
  "source": "manual|import|email-bison|instantly|gohighlevel",
  "customFields": {},
  "calledWith": "string",
  "leadFolder": "UUID|'warm'|null",
  "lineType": "string|null",
  "phoneVerified": false,
  "processingNumber": false,
  "processingNumberTaskID": "string",
  "numberFound": false,
  "assignedTo": ["UUID"],
  "emailBison": {
    "repliedPositively": false, "exactReply": "",
    "campaignName": "", "workspaceName": "",
    "mobileNumber": "", "instanceUrl": "",
    "workspaceId": "", "leadId": "", "replyId": "",
    "replyUUID": "", "campaignId": "", "campaignEventId": ""
  },
  "instantly": { "...same as emailBison..." },
  "gohighlevel": {
    "eventType": "", "triggerType": "",
    "contactId": "", "opportunityId": "",
    "locationId": "", "pipelineId": "",
    "pipelineName": "", "stageId": "",
    "stageName": "", "tags": []
  }
}
```
- **Response:** `{ message: string, lead: { id, ...allFields, createdAt, updatedAt } }`

### GET /leads/{organization}
**List leads**
- **Query Params:** `pageNumber` (default 1), `pageSize` (default 10000, max 10000), `sort`, `filter` (with `leadFolder` property)
- **Response:** Paginated with `meta: { pageNumber, pageSize, totalPages, totalResults }` and `data` array

### GET /leads/{organization}/{id}
**Get single lead**
- **Response:** `{ message: string, lead: {...} }`

### PUT /leads/{organization}/{id}
**Update single lead**
- **Request Body:** Any lead fields (all optional)
- **Response:** `{ message: string, lead: {...} }`

### PUT /leads/{organization}
**Bulk update leads**
- **Request Body:** `{ data: { update: { ...fields }, ids: ["UUID"] } }`
- **Response:** Array of updated leads

### DELETE /leads/{organization}
**Bulk delete leads**
- **Request Body:** `{ ids: ["UUID"] }`
- **Response:** `{ message: string }`

### POST /leads/uploads/{organization}
**Bulk upload leads (CSV)**
- **Response:** `{ message, leads[], totalRows, validRows, totalCreated, duplicates }`

---

## 7. Lead Folders

### POST /lead-folders/{organization}
**Create lead folder**
- **Request Body:** `{ data: { profile: { name: string }, allowedUsers: ["UUID"] } }`
- **Response:** `{ data: { id, profile, organization, allowedUsers, createdAt, updatedAt, leadsCount } }`

### GET /lead-folders/{organization}
**List lead folders**
- **Query Params:** `pageNumber`, `pageSize`, `sort`, `filter`
- **Response:** Paginated with `pinned` boolean field per folder

### GET /lead-folders/{organization}/{id}
**Get single folder** (id can be UUID or "warm")

### PUT /lead-folders/{organization}/{id}
**Update folder**
- **Request Body:** `{ data: { profile: { name }, allowedUsers: [] } }`

### DELETE /lead-folders/{organization}/{id}
**Delete folder**
- **Response:** `{ message: string }`

---

## 8. Lead Enrichments

### POST /lead-enrichments/{organization}
**Bulk enrichment job**
- **Request Body:**
```json
{
  "data": [{
    "id": "UUID",
    "linkedinUrl": "string (required)",
    "verify": false,
    "saveLead": true,
    "excludeNonMobile": true
  }]
}
```
- **Response:** Enrichment job with `id`, `status`, `leads[]` (each with `result: { phone, status, provider, error, lineType, phoneVerified }`)

### GET /lead-enrichments/{organization}
**List enrichment jobs**
- **Query Params:** `pageNumber`, `pageSize`, `sort`, `filter`

### GET /lead-enrichments/{organization}/{id}
**Get enrichment job details**

### GET /lead-enrichments/status/{organization}/{id}
**Get enrichment job progress**
- **Response:** `{ data: { status, queue: { position, total }, progress: { completed, total, percent }, finishedAt } }`

### GET /lead-enrichments/csv/{organization}/{id}
**Download enrichment results as CSV**
- **Query Params:** `type` = "success" | "no_phone"

### POST /lead-enrichments/validate/{organization}/{id}/{lead}
**Validate lead phone within enrichment job**

### POST /lead-enrichments/validate/{organization}/{lead}
**Validate lead phone (standalone)**

### POST /lead-enrichments/enrich/{organization}/{lead}
**Enrich single lead**

### POST /lead-enrichments/enrich-high-precision/{organization}/{lead}
**Enrich single lead (high precision)**

### POST /lead-enrichments/enrich-missing/{organization}
**Enrich leads with missing phone numbers**
- **Request Body:** `{ leadIDs: ["UUID"] }`
- **Response:** `{ data: { total, enriched, failed, skipped } }`

---

## 9. Telnyx / Calls & Phone Numbers

### Route Groups (from documentation bundle)
| Group | Base Path |
|-------|-----------|
| Telnyx Calls | `/telnyx/calls/{organization}` |
| Phone Numbers | `/telnyx/phone-numbers/{organization}` |
| Available Phone Numbers | `/telnyx/available-phone-numbers/{organization}` |
| Number Orders | `/telnyx/number-orders/{organization}` |

### Inferred Call Endpoints
- **GET /telnyx/calls/{organization}** - List calls (query key: `['calls', orgID]`)
- **PUT /telnyx/calls/{organization}/{id}** - Update call (notes, lead association)
- **POST /telnyx/calls/{organization}/dtmf** - Send DTMF digits: `{ org, id, digits }`

### Call Object Schema
```json
{
  "id": "string",
  "status": "completed|answered|missed|queued|initiated|ringing|in-progress|busy|failed|no-answer",
  "direction": "incoming|outgoing",
  "from": "string (phone)",
  "to": "string (phone)",
  "startedAt": "datetime",
  "duration": 0,
  "note": "string",
  "recordingUrl": "string|null",
  "transcription": {
    "text": "string",
    "chunks": []
  },
  "answeringMachineDetection": "string",
  "lead": { "id": "", "name": "", "primaryPhone": "", "company": { "name": "" } }
}
```

### TelnyxRTC WebSocket Events
| Event | Description |
|-------|-------------|
| `telnyx.ready` | Client connected and ready |
| `telnyx.notification` | Incoming call notification |
| `telnyx.error` | Connection error |

### Call Control (WebRTC client-side)
- `client.connect()` / `client.disconnect()`
- `call.answer()` / `call.hangup()`
- `call.state` states: `initiated`, `ringing`, `incoming`, `active`, `answered`, `closed`, `hangup`, `destroy`

---

## 10. Integrations

### POST /integrations/email-bison/{organization}
**Process lead from Email Bison**
- **Query Params:** `s` (signature, required, minLength 1)
- **Response:** `{ data: { accepted, reason, created, lead } }`

### POST /integrations/email-bison/{organization}/enable
**Enable/disable Email Bison**
- **Request Body:** `{ enabled: boolean }`
- **Response:** `{ data: { enabled, status: "active"|"pending"|"error"|"disabled", error? } }`

### POST /integrations/instantly/{organization}
**Process lead from Instantly**
- **Query Params:** `s` (signature, required)
- **Response:** Same as Email Bison

### POST /integrations/instantly/{organization}/enable
**Enable/disable Instantly**
- **Request Body:** `{ enabled: boolean }`

### GET /integrations/ghl/connect/start/{organization}
**Start GoHighLevel OAuth connection**
- **Query Params:** `locationId?`, `mode?` ("redirect"|"json")
- **Response:** `{ data: { authorizeUrl, stateExpiresAt } }`

### GET /integrations/gohighlevel/connect/start/{organization}
**Start GoHighLevel OAuth (alternate path)**
- Same params and response as above

---

## 11. Webhooks

### Webhook Events
| Event Type | Description |
|------------|-------------|
| `call.initiated` | Call started |
| `call.answered` | Call answered |
| `call.completed` | Call finished |
| `lead.created` | New lead created |
| `lead.updated` | Lead modified |
| `lead.deleted` | Lead removed |
| `enrichment.completed` | Enrichment job finished |

### Webhook Payload Schema
```json
{
  "id": "event_uuid",
  "type": "lead.updated",
  "createdAt": "2026-03-22T12:34:56.000Z",
  "organizationId": "acme",
  "data": {
    "lead": {
      "id": "lead_uuid",
      "status": "answered"
    }
  }
}
```

### Webhook Delivery Headers
| Header | Description |
|--------|-------------|
| `X-LeadHero-Event` | Event type (e.g., `lead.updated`) |
| `X-LeadHero-Timestamp` | Unix timestamp ms |
| `X-LeadHero-Webhook-Id` | Webhook configuration ID |
| `X-LeadHero-Delivery-Id` | Unique event/delivery ID |
| `X-LeadHero-Signature` | `sha256=HMAC_SIGNATURE` |

### Webhook Security
- **Signature:** HMAC SHA-256 of `timestamp + "." + body`
- **Retries:** 5 attempts, exponential backoff (2s, 4s, 8s, 16s)
- **Timeout:** 15 seconds per request
- **Success:** 2xx HTTP responses only

---

## 12. API Documentation Endpoints

### GET /documentation/api-key
**Swagger UI** for API key-authenticated endpoints

### GET /documentation/api-key/openapi.json
**OpenAPI specification** (JSON)

---

## 13. Stripe Configuration

- **Publishable Key:** `pk_live_51RMHSULux0CQ33Qbqj9dclZgRiPlcnHJGZFOZcfYMfuXAE8GF1cpWAWEF2cWv5fbrlZF01GsBUTLZryOZrSjsNkj00mPsaLTY1`
- **Elements:** Payment Element, Address Element (billing mode)

---

## Query Cache Keys (TanStack Query)

These reveal the internal data fetching structure:

| Key | Description |
|-----|-------------|
| `['user']` | Current user data |
| `['quicklist']` | Organization quick list |
| `['organization', orgID]` | Organization details |
| `['leads', orgID]` | Leads list |
| `['lead', orgID, leadID]` | Single lead |
| `['lead-folders', orgID]` | Lead folders |
| `['calls', orgID]` | Calls list |
| `['calls', orgID, 'lead-sidebar']` | Calls for lead sidebar |
| `['calls', orgID, 'organization-home']` | Calls for home page |
| `['analytics', orgID, from, to]` | Analytics data |
| `['usage', orgID, from, to]` | Usage metrics |
| `['invoiceAndPaymentIntents', orgID]` | Billing history |
| `['payment-methods', orgID]` | Payment methods |

---

## Lead Status Enum Values

`"cold"` | `"warm"` | `"called"` | `"called-back"` | `"answered"` | `"booked"` | `"dnc"`

## Lead Source Enum Values

`"manual"` | `"import"` | `"email-bison"` | `"instantly"` | `"gohighlevel"`

## Enrichment Status Enum Values

`"pending"` | `"in_progress"` | `"completed"` | `"partial"` | `"failed"`

## Integration Status Enum Values

`"active"` | `"pending"` | `"error"` | `"disabled"`
