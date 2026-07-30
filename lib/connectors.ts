export type ConnectorCategory =
  | "Communication"
  | "Files & docs"
  | "CRM & sales"
  | "Projects"
  | "Finance"
  | "Operations";

export interface BusinessConnector {
  id: string;
  name: string;
  category: ConnectorCategory;
  icon: string;
  tagline: string;
  capabilities: string[];
  connectionType: "app" | "mcp";
  defaultUrl?: string;
  guideKey?: string;
}

export interface KnownServiceGuide {
  label: string;
  icon: string;
  hostname: string;
  urlPlaceholder: string;
  tokenHelp: string;
  tokenLinkLabel: string;
  tokenLinkPath: string;
  fallbackTokenUrl: string;
  steps: string[];
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "Communication",
  "Files & docs",
  "CRM & sales",
  "Projects",
  "Finance",
  "Operations",
];

/** Ready-to-connect business apps — credentials are added when the user clicks Connect. */
export const BUSINESS_CONNECTORS: BusinessConnector[] = [
  // Communication
  {
    id: "slack",
    name: "Slack",
    category: "Communication",
    icon: "💬",
    tagline: "Post updates and read channel context for workflow notifications.",
    capabilities: ["Read channels", "Post messages", "Thread replies"],
    connectionType: "app",
    defaultUrl: "https://slack.com/api",
    guideKey: "slack",
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    category: "Communication",
    icon: "🟦",
    tagline: "Notify teams and pull meeting context into governed workflows.",
    capabilities: ["Team messages", "Channel posts", "Meeting summaries"],
    connectionType: "app",
    defaultUrl: "https://graph.microsoft.com",
    guideKey: "teams",
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    category: "Communication",
    icon: "📧",
    tagline: "Read inbox threads and draft follow-ups — sending stays approval-gated.",
    capabilities: ["Read mail", "Calendar events", "Draft replies"],
    connectionType: "app",
    defaultUrl: "https://graph.microsoft.com",
    guideKey: "outlook",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Communication",
    icon: "✉️",
    tagline: "Turn incoming briefs and client emails into structured workflow input.",
    capabilities: ["Read inbox", "Labels & filters", "Draft messages"],
    connectionType: "app",
    defaultUrl: "https://gmail.googleapis.com",
    guideKey: "gmail",
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "Communication",
    icon: "✈️",
    tagline: "Send alerts to ops channels and receive lightweight approvals on mobile.",
    capabilities: ["Bot messages", "Group alerts", "Inline actions"],
    connectionType: "app",
    defaultUrl: "https://api.telegram.org",
    guideKey: "telegram",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "Communication",
    icon: "📱",
    tagline: "Route client updates through approved WhatsApp Business templates.",
    capabilities: ["Template messages", "Delivery status", "Client threads"],
    connectionType: "app",
    defaultUrl: "https://graph.facebook.com",
    guideKey: "whatsapp",
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "Communication",
    icon: "🎥",
    tagline: "Pull meeting recordings and summaries into post-meeting workflows.",
    capabilities: ["Meeting list", "Transcripts", "Participant notes"],
    connectionType: "app",
    defaultUrl: "https://api.zoom.us",
    guideKey: "zoom",
  },
  // Files & docs
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Files & docs",
    icon: "📁",
    tagline: "Read approved folders and attach generated outputs to shared drives.",
    capabilities: ["List folders", "Read files", "Upload drafts"],
    connectionType: "app",
    defaultUrl: "https://www.googleapis.com/drive/v3",
    guideKey: "google-drive",
  },
  {
    id: "onedrive",
    name: "OneDrive",
    category: "Files & docs",
    icon: "☁️",
    tagline: "Sync briefs and deliverables from Microsoft 365 document libraries.",
    capabilities: ["Shared drives", "File read", "Version history"],
    connectionType: "app",
    defaultUrl: "https://graph.microsoft.com",
    guideKey: "onedrive",
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    category: "Files & docs",
    icon: "🗂️",
    tagline: "Index team sites and document libraries used in delivery workflows.",
    capabilities: ["Site libraries", "Metadata", "List items"],
    connectionType: "app",
    defaultUrl: "https://graph.microsoft.com",
    guideKey: "sharepoint",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "Files & docs",
    icon: "📦",
    tagline: "Collect creative assets and route them through review workflows.",
    capabilities: ["Team folders", "File previews", "Shared links"],
    connectionType: "app",
    defaultUrl: "https://api.dropboxapi.com",
    guideKey: "dropbox",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Files & docs",
    icon: "📓",
    tagline: "Sync briefs, wikis, and delivery checklists from Notion databases.",
    capabilities: ["Database rows", "Page content", "Status updates"],
    connectionType: "app",
    defaultUrl: "https://api.notion.com",
    guideKey: "notion",
  },
  // CRM & sales
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM & sales",
    icon: "🟠",
    tagline: "Enrich workflows with deals, contacts, and pipeline stage changes.",
    capabilities: ["Contacts", "Deals", "Company records"],
    connectionType: "app",
    defaultUrl: "https://api.hubapi.com",
    guideKey: "hubspot",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM & sales",
    icon: "☁️",
    tagline: "Keep account context and opportunity updates aligned with delivery work.",
    capabilities: ["Accounts", "Opportunities", "Tasks"],
    connectionType: "app",
    defaultUrl: "https://login.salesforce.com",
    guideKey: "salesforce",
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "CRM & sales",
    icon: "📊",
    tagline: "Trigger workflows when deals move or activities need follow-up.",
    capabilities: ["Deals", "Activities", "Organizations"],
    connectionType: "app",
    defaultUrl: "https://api.pipedrive.com",
    guideKey: "pipedrive",
  },
  // Projects
  {
    id: "jira",
    name: "Jira",
    category: "Projects",
    icon: "🔷",
    tagline: "Create and update issues when workflows detect delivery exceptions.",
    capabilities: ["Issues", "Sprints", "Comments"],
    connectionType: "app",
    defaultUrl: "https://your-domain.atlassian.net",
    guideKey: "jira",
  },
  {
    id: "linear",
    name: "Linear",
    category: "Projects",
    icon: "⬡",
    tagline: "Sync engineering and ops tasks with structured workflow outcomes.",
    capabilities: ["Issues", "Projects", "Cycles"],
    connectionType: "app",
    defaultUrl: "https://api.linear.app",
    guideKey: "linear",
  },
  {
    id: "asana",
    name: "Asana",
    category: "Projects",
    icon: "🎯",
    tagline: "Turn workflow outputs into owned tasks with due dates and assignees.",
    capabilities: ["Tasks", "Projects", "Sections"],
    connectionType: "app",
    defaultUrl: "https://app.asana.com/api/1.0",
    guideKey: "asana",
  },
  {
    id: "trello",
    name: "Trello",
    category: "Projects",
    icon: "📋",
    tagline: "Move cards across boards when workflow checkpoints complete.",
    capabilities: ["Boards", "Cards", "Checklists"],
    connectionType: "app",
    defaultUrl: "https://api.trello.com",
    guideKey: "trello",
  },
  {
    id: "monday",
    name: "Monday.com",
    category: "Projects",
    icon: "🗓️",
    tagline: "Update work boards and item statuses from automated process steps.",
    capabilities: ["Boards", "Items", "Status columns"],
    connectionType: "app",
    defaultUrl: "https://api.monday.com/v2",
    guideKey: "monday",
  },
  {
    id: "airtable",
    name: "Airtable",
    category: "Projects",
    icon: "🧩",
    tagline: "Read and write structured records — ideal for HyperAgent-style ops bases.",
    capabilities: ["Bases", "Tables", "Automations"],
    connectionType: "app",
    defaultUrl: "https://api.airtable.com",
    guideKey: "airtable",
  },
  // Finance
  {
    id: "stripe",
    name: "Stripe",
    category: "Finance",
    icon: "💳",
    tagline: "Reconcile payments and flag billing exceptions before invoicing.",
    capabilities: ["Payments", "Customers", "Invoices"],
    connectionType: "app",
    defaultUrl: "https://api.stripe.com",
    guideKey: "stripe",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Finance",
    icon: "🧾",
    tagline: "Prepare invoice drafts from approved time and expense workflows.",
    capabilities: ["Invoices", "Expenses", "Customers"],
    connectionType: "app",
    defaultUrl: "https://quickbooks.api.intuit.com",
    guideKey: "quickbooks",
  },
  {
    id: "xero",
    name: "Xero",
    category: "Finance",
    icon: "📒",
    tagline: "Sync billable work into finance review before books are updated.",
    capabilities: ["Invoices", "Contacts", "Bank feeds"],
    connectionType: "app",
    defaultUrl: "https://api.xero.com",
    guideKey: "xero",
  },
  // Operations
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Operations",
    icon: "📅",
    tagline: "Schedule workflow triggers and attach outcomes to calendar events.",
    capabilities: ["Events", "Availability", "Reminders"],
    connectionType: "app",
    defaultUrl: "https://www.googleapis.com/calendar/v3",
    guideKey: "google-calendar",
  },
  {
    id: "calendly",
    name: "Calendly",
    category: "Operations",
    icon: "🗓️",
    tagline: "Start intake workflows when new client meetings are booked.",
    capabilities: ["Scheduled events", "Invitees", "Routing forms"],
    connectionType: "app",
    defaultUrl: "https://api.calendly.com",
    guideKey: "calendly",
  },
  {
    id: "github",
    name: "GitHub",
    category: "Operations",
    icon: "🐙",
    tagline: "Link release and issue activity to delivery and support workflows.",
    capabilities: ["Issues", "Pull requests", "Releases"],
    connectionType: "app",
    defaultUrl: "https://api.github.com",
    guideKey: "github",
  },
  {
    id: "scoro",
    name: "Scoro",
    category: "Operations",
    icon: "🔷",
    tagline: "Projects, time, and CRM via the Scoro MCP server.",
    capabilities: ["Projects", "Tasks", "Time entries"],
    connectionType: "mcp",
    defaultUrl: "https://yourcompany.scoro.com/mcp",
    guideKey: "scoro",
  },
];

export const KNOWN_SERVICE_GUIDES: Record<string, KnownServiceGuide> = {
  scoro: {
    label: "Scoro",
    icon: "🔷",
    hostname: "scoro.com",
    urlPlaceholder: "https://yourcompany.scoro.com/mcp",
    tokenHelp:
      "Copy your MCP server address from Scoro → Settings → Site settings → Integrations → Scoro MCP.",
    tokenLinkLabel: "Open Scoro MCP settings →",
    tokenLinkPath: "/settings/site/integrations",
    fallbackTokenUrl: "https://support.scoro.com/hc/en-us/articles/39712766664589-Scoro-MCP-server",
    steps: [
      "In Scoro go to Settings → Site settings → Integrations → Scoro MCP and copy your MCP server address.",
      "Paste it in the MCP server URL field above.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  notion: {
    label: "Notion",
    icon: "📓",
    hostname: "notion.com",
    urlPlaceholder: "https://api.notion.com",
    tokenHelp: "Create an internal integration, share the pages WorkPilot should access, then paste the secret.",
    tokenLinkLabel: "Open Notion integrations →",
    tokenLinkPath: "/my-integrations",
    fallbackTokenUrl: "https://www.notion.so/my-integrations",
    steps: [
      "Open notion.so/my-integrations and create a new internal integration.",
      "Copy the Internal Integration Secret.",
      "Share the pages/databases with your integration in Notion.",
      "Paste the secret below, then press “Test & connect”.",
    ],
  },
  slack: {
    label: "Slack",
    icon: "💬",
    hostname: "slack.com",
    urlPlaceholder: "https://slack.com/api",
    tokenHelp: "Create a Slack app, add scopes, install it to your workspace, then paste the Bot token (xoxb-…).",
    tokenLinkLabel: "Open Slack apps →",
    tokenLinkPath: "/apps",
    fallbackTokenUrl: "https://api.slack.com/apps",
    steps: [
      "Open api.slack.com/apps and create or select an app.",
      "Add scopes under OAuth & Permissions and install to your workspace.",
      "Copy the Bot User OAuth Token (xoxb-…).",
      "Paste the token below, then press “Test & connect”.",
    ],
  },
  telegram: {
    label: "Telegram",
    icon: "✈️",
    hostname: "telegram.org",
    urlPlaceholder: "https://api.telegram.org/bot<token>",
    tokenHelp: "Talk to @BotFather on Telegram to create a bot and copy the HTTP API token.",
    tokenLinkLabel: "Telegram Bot API docs →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://core.telegram.org/bots/tutorial",
    steps: [
      "Message @BotFather in Telegram and run /newbot to create a bot.",
      "Copy the bot token BotFather gives you.",
      "Paste https://api.telegram.org/bot<token> as the endpoint (or paste the token below).",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  outlook: {
    label: "Microsoft Outlook",
    icon: "📧",
    hostname: "microsoft.com",
    urlPlaceholder: "https://graph.microsoft.com/v1.0/me",
    tokenHelp: "Register an app in Azure AD with Mail.Read and offline_access, then paste the access token or configure OAuth.",
    tokenLinkLabel: "Azure app registrations →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    steps: [
      "Register an application in Microsoft Entra ID (Azure).",
      "Grant Mail.Read (and Calendar.Read if needed) delegated permissions.",
      "Complete admin consent for your tenant.",
      "Paste your Graph API endpoint and token, then press “Test & connect”.",
    ],
  },
  teams: {
    label: "Microsoft Teams",
    icon: "🟦",
    hostname: "microsoft.com",
    urlPlaceholder: "https://graph.microsoft.com/v1.0/teams",
    tokenHelp: "Use a Microsoft Graph app registration with ChannelMessage.Send and Team.ReadBasic.All.",
    tokenLinkLabel: "Azure app registrations →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    steps: [
      "Register an app in Microsoft Entra ID with Teams permissions.",
      "Install the app to the teams you want WorkPilot to reach.",
      "Paste the Graph endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  gmail: {
    label: "Gmail",
    icon: "✉️",
    hostname: "googleapis.com",
    urlPlaceholder: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    tokenHelp: "Create a Google Cloud project, enable the Gmail API, and use OAuth or a service account with domain-wide delegation.",
    tokenLinkLabel: "Google Cloud Console →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    steps: [
      "Create a project in Google Cloud and enable the Gmail API.",
      "Configure OAuth consent and create credentials.",
      "Paste your API endpoint and access token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  "google-drive": {
    label: "Google Drive",
    icon: "📁",
    hostname: "googleapis.com",
    urlPlaceholder: "https://www.googleapis.com/drive/v3/files",
    tokenHelp: "Enable the Google Drive API in Google Cloud and authorise read/write to approved shared drives.",
    tokenLinkLabel: "Google Drive API →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com",
    steps: [
      "Enable Google Drive API in your Google Cloud project.",
      "Create OAuth credentials scoped to drive.readonly or drive.file as needed.",
      "Paste the endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  "google-calendar": {
    label: "Google Calendar",
    icon: "📅",
    hostname: "googleapis.com",
    urlPlaceholder: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    tokenHelp: "Enable Google Calendar API and authorise calendar.events read/create for your workspace.",
    tokenLinkLabel: "Google Calendar API →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
    steps: [
      "Enable Google Calendar API in Google Cloud.",
      "Create OAuth credentials with calendar scopes.",
      "Paste the endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  onedrive: {
    label: "OneDrive",
    icon: "☁️",
    hostname: "graph.microsoft.com",
    urlPlaceholder: "https://graph.microsoft.com/v1.0/me/drive/root/children",
    tokenHelp: "Use Microsoft Graph with Files.Read.All or Sites.Read.All for shared libraries.",
    tokenLinkLabel: "Microsoft Graph docs →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://learn.microsoft.com/graph/api/resources/onedrive",
    steps: [
      "Register a Microsoft Graph application with file permissions.",
      "Grant admin consent for your organisation.",
      "Paste the Graph endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  sharepoint: {
    label: "SharePoint",
    icon: "🗂️",
    hostname: "sharepoint.com",
    urlPlaceholder: "https://graph.microsoft.com/v1.0/sites",
    tokenHelp: "Grant Sites.Read.All or Sites.Selected on your Microsoft Graph app registration.",
    tokenLinkLabel: "SharePoint Graph API →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://learn.microsoft.com/graph/api/resources/sharepoint",
    steps: [
      "Register a Graph app with SharePoint site permissions.",
      "Specify which site collections WorkPilot may access.",
      "Paste the endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  dropbox: {
    label: "Dropbox",
    icon: "📦",
    hostname: "dropbox.com",
    urlPlaceholder: "https://api.dropboxapi.com/2/files/list_folder",
    tokenHelp: "Create a Dropbox app with scoped access to team folders WorkPilot should read.",
    tokenLinkLabel: "Dropbox App Console →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://www.dropbox.com/developers/apps",
    steps: [
      "Create an app in the Dropbox App Console.",
      "Choose scoped access and generate an access token.",
      "Paste the API endpoint and token below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  airtable: {
    label: "Airtable",
    icon: "🧩",
    hostname: "airtable.com",
    urlPlaceholder: "https://api.airtable.com/v0",
    tokenHelp: "Create a personal access token with read/write on the bases you want WorkPilot to use.",
    tokenLinkLabel: "Airtable tokens →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://airtable.com/create/tokens",
    steps: [
      "Open airtable.com/create/tokens and create a personal access token.",
      "Scope it to the bases and tables you need.",
      "Paste https://api.airtable.com/v0/<baseId> as the endpoint.",
      "Add the token below and press “Test & connect”.",
    ],
  },
  hubspot: {
    label: "HubSpot",
    icon: "🟠",
    hostname: "hubapi.com",
    urlPlaceholder: "https://api.hubapi.com/crm/v3/objects/contacts",
    tokenHelp: "Create a private app in HubSpot and copy the access token with CRM scopes.",
    tokenLinkLabel: "HubSpot private apps →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://developers.hubspot.com/docs/api/private-apps",
    steps: [
      "In HubSpot go to Settings → Integrations → Private apps.",
      "Create an app with the CRM scopes you need.",
      "Copy the access token and paste it below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  salesforce: {
    label: "Salesforce",
    icon: "☁️",
    hostname: "salesforce.com",
    urlPlaceholder: "https://your-instance.salesforce.com/services/data/v59.0",
    tokenHelp: "Create a connected app or use an integration user with API access.",
    tokenLinkLabel: "Salesforce Setup →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
    steps: [
      "Create a Connected App in Salesforce Setup.",
      "Enable OAuth and note the client ID/secret or use a security token.",
      "Paste your instance URL and credentials below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
  jira: {
    label: "Jira",
    icon: "🔷",
    hostname: "atlassian.net",
    urlPlaceholder: "https://your-domain.atlassian.net/rest/api/3/issue",
    tokenHelp: "Create an Atlassian API token for your site and use it with your Atlassian account email.",
    tokenLinkLabel: "Atlassian API tokens →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    steps: [
      "Generate an API token at id.atlassian.com.",
      "Paste your Jira site URL (your-domain.atlassian.net).",
      "Add the token below and press “Test & connect”.",
    ],
  },
  stripe: {
    label: "Stripe",
    icon: "💳",
    hostname: "stripe.com",
    urlPlaceholder: "https://api.stripe.com/v1/customers",
    tokenHelp: "Use a restricted Stripe secret key with only the permissions this workflow needs.",
    tokenLinkLabel: "Stripe API keys →",
    tokenLinkPath: "",
    fallbackTokenUrl: "https://dashboard.stripe.com/apikeys",
    steps: [
      "Open Stripe Dashboard → Developers → API keys.",
      "Create a restricted key for read-only or specific resources.",
      "Paste the endpoint and secret key below.",
      "Press “Test & connect”, then “Save connection”.",
    ],
  },
};

export function getConnectorByName(name: string): BusinessConnector | undefined {
  const key = name.trim().toLowerCase();
  return BUSINESS_CONNECTORS.find(
    (c) => c.name.toLowerCase() === key || c.id === key || key.includes(c.name.toLowerCase()),
  );
}

export function resolveKnownService(
  url: string,
  name: string,
): (KnownServiceGuide & { tokenUrl: string }) | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    for (const service of Object.values(KNOWN_SERVICE_GUIDES)) {
      if (hostname.endsWith(service.hostname) || hostname.includes(service.hostname.replace(".com", ""))) {
        const tokenUrl = service.tokenLinkPath
          ? parsed.origin + service.tokenLinkPath
          : service.fallbackTokenUrl;
        return { ...service, tokenUrl };
      }
    }
  } catch {
    /* invalid URL while typing */
  }

  const connector = getConnectorByName(name);
  if (connector?.guideKey) {
    const guide = KNOWN_SERVICE_GUIDES[connector.guideKey];
    if (guide) {
      let tokenUrl = guide.fallbackTokenUrl;
      try {
        tokenUrl = guide.tokenLinkPath ? new URL(url).origin + guide.tokenLinkPath : guide.fallbackTokenUrl;
      } catch {
        /* keep fallback */
      }
      return { ...guide, tokenUrl };
    }
  }

  const key = name.trim().toLowerCase();
  const byName = KNOWN_SERVICE_GUIDES[key];
  if (byName) {
    let tokenUrl = byName.fallbackTokenUrl;
    try {
      tokenUrl = byName.tokenLinkPath ? new URL(url).origin + byName.tokenLinkPath : byName.fallbackTokenUrl;
    } catch {
      /* keep fallback */
    }
    return { ...byName, tokenUrl };
  }

  return null;
}

export function connectorModalDefaults(connector: BusinessConnector): {
  type: "app" | "mcp";
  name: string;
  url: string;
} {
  return {
    type: connector.connectionType,
    name: connector.connectionType === "mcp" ? `${connector.name} MCP` : connector.name,
    url: connector.defaultUrl ?? "",
  };
}

/**
 * Has this catalog connector been connected?
 *
 * Matches on `connectorId` first — that is what the API stores — and only falls
 * back to fuzzy name matching for rows created before connectorId existed. Name
 * matching alone was too loose: a connection called "Drive" marked every
 * connector whose name contained "drive" as connected.
 */
export function isConnectorConnected(
  name: string,
  saved: Array<{ name: string; connectorId?: string; status?: string }>,
): boolean {
  const key = name.toLowerCase();
  return saved.some((c) => {
    if (c.status && c.status !== "connected") return false;
    if (c.connectorId && c.connectorId.toLowerCase() === key) return true;
    const cname = c.name.toLowerCase();
    return cname === key || cname.includes(key) || key.includes(cname);
  });
}
