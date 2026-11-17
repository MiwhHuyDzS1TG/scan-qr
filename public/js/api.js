class ApiClient {
  constructor() {
    this.csrf = "";
  }

  async request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET" && this.csrf) headers["X-CSRF-Token"] = this.csrf;
    const response = await fetch(path, { credentials: "same-origin", ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.detail || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async session() {
    const data = await this.request("/api/auth/session");
    this.csrf = data.csrf_token || "";
    return data;
  }

  async login(username, password) {
    const data = await this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    this.csrf = data.csrf_token || "";
    return data;
  }

  logout() { return this.request("/api/auth/logout", { method: "POST" }); }
  members() { return this.request("/api/members"); }
  health(probe = false) { return this.request(`/api/health?probe=${probe ? "true" : "false"}`); }
  scan(memberId, batchId, requestId) {
    return this.request("/api/scan", {
      method: "POST",
      body: JSON.stringify({ member_id: memberId, batch_id: batchId, request_id: requestId }),
    });
  }
}

export const api = new ApiClient();

