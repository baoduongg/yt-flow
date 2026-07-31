const configForm = document.getElementById("config-form");
const configStatus = document.getElementById("config-status");
const queueList = document.getElementById("queue-list");
const carSelect = document.getElementById("car-select");
const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");

const sections = {
  idlePreview: document.getElementById("idle-preview"),
  progress: document.getElementById("progress"),
  videoReview: document.getElementById("video-review"),
  metadataReview: document.getElementById("metadata-review"),
  result: document.getElementById("result"),
};

function showPhase(phaseKey, phaseKeySecondary = null) {
  for (const [key, el] of Object.entries(sections)) {
    if (!el) continue;
    if (key === phaseKey || key === phaseKeySecondary) {
      el.hidden = false;
      el.classList.add("active");
      // Trigger browser style recalculation before adding transition class
      el.getBoundingClientRect();
      el.classList.add("show");
    } else {
      el.classList.remove("show");
      el.classList.remove("active");
      el.hidden = true;
    }
  }
}

async function loadConfig() {
  const config = await fetch("/api/config").then((r) => r.json());
  configForm.innerHTML = "";
  for (const [key, info] of Object.entries(config)) {
    const label = document.createElement("label");
    label.className = "config-label";
    
    const labelText = document.createElement("span");
    labelText.className = "label-title";
    labelText.textContent = info.isSet ? `${key} (${info.masked})` : key;
    label.appendChild(labelText);
    
    const input = document.createElement("input");
    input.type = "text";
    input.name = key;
    input.placeholder = info.isSet ? "Để trống để giữ nguyên" : "Nhập giá trị cấu hình...";
    label.appendChild(input);
    
    configForm.appendChild(label);
  }
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-save";
  saveBtn.textContent = "Lưu Cấu Hình";
  configForm.appendChild(saveBtn);
}

configForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  for (const input of configForm.querySelectorAll("input")) {
    if (input.value) body[input.name] = input.value;
  }
  configStatus.className = "status-msg status-loading";
  configStatus.textContent = "Đang lưu cấu hình...";
  
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    configStatus.className = "status-msg status-success";
    configStatus.textContent = "Đã lưu thành công!";
    await loadConfig();
    await loadYoutubeChannelInfo();
  } else {
    const err = await res.json();
    configStatus.className = "status-msg status-error";
    configStatus.textContent = `Lỗi: ${err.error}`;
  }
});

async function loadCars() {
  const { pool, queue } = await fetch("/api/cars").then((r) => r.json());
  if (queueList) {
    queueList.innerHTML = "";
    if (queue.length === 0) {
      const li = document.createElement("li");
      li.className = "queue-empty";
      li.textContent = "Hàng chờ trống";
      queueList.appendChild(li);
    } else {
      for (const car of queue) {
        const li = document.createElement("li");
        li.className = "queue-item";
        li.textContent = car;
        queueList.appendChild(li);
      }
    }
  }
  if (carSelect) {
    carSelect.innerHTML = '<option value="">-- dùng queue mặc định --</option>';
    for (const car of pool) {
      const option = document.createElement("option");
      option.value = car;
      option.textContent = car;
      carSelect.appendChild(option);
    }
  }
}

generateBtn.addEventListener("click", async () => {
  const car = carSelect.value || undefined;
  if (generateStatus) {
    generateStatus.className = "status-msg";
    generateStatus.textContent = "Đang gửi yêu cầu khởi tạo...";
  }
  
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ car }),
  });
  if (generateStatus) {
    if (res.status === 409) {
      generateStatus.className = "status-msg status-error";
      generateStatus.textContent = "Đang bận, vui lòng đợi job hiện tại hoàn tất.";
    } else if (!res.ok) {
      generateStatus.className = "status-msg status-error";
      generateStatus.textContent = "Không thể khởi tạo job. Vui lòng kiểm tra lại.";
    } else {
      generateStatus.className = "status-msg status-success";
      generateStatus.textContent = "Khởi tạo thành công!";
    }
  }
});

document.getElementById("approve-video-btn").addEventListener("click", () => {
  fetch("/api/video-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: true }),
  });
});

document.getElementById("reject-video-btn").addEventListener("click", () => {
  fetch("/api/video-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved: false }),
  });
});

document.getElementById("upload-btn").addEventListener("click", () => {
  const title = document.getElementById("meta-title").value;
  const description = document.getElementById("meta-description").value;
  const tags = document
    .getElementById("meta-tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  fetch("/api/metadata-decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, tags }),
  });
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  const res = await fetch("/api/reset", { method: "POST" });
  if (res.ok) {
    loadCars();
  } else {
    console.error("Lỗi khi reset trạng thái pipeline.");
  }
});

function renderState(state) {
  // Sync selected car info to Right Column Info Card
  const selectedCar = state.car || carSelect.value || "Mặc định (Queue)";
  const infoCarEl = document.getElementById("info-selected-car");
  if (infoCarEl) infoCarEl.textContent = selectedCar;

  // Toggle checklist active state in Left Column based on the current step/phase
  const checkLaunch = document.getElementById("check-browser-launch");
  const checkNav = document.getElementById("check-browser-nav");
  const checkRender = document.getElementById("check-browser-render");
  
  if (checkLaunch) checkLaunch.classList.remove("checked");
  if (checkNav) checkNav.classList.remove("checked");
  if (checkRender) checkRender.classList.remove("checked");

  // Sync the current phase as an attribute on the main dashboard container for CSS targeting
  const boardEl = document.getElementById("main-dashboard");
  if (boardEl) {
    boardEl.setAttribute("data-phase", state.phase || "idle");
  }

  const reviewActionsEl = document.querySelector(".video-review-actions");

  if (state.phase === "running") {
    showPhase("progress");
    document.getElementById("progress-car").textContent = state.car || "Chưa xác định";
    document.getElementById("progress-step").textContent = state.step;
    
    // Check steps and set checkboxes in sidebar checklist
    const stepText = (state.step || "").toLowerCase();
    if (stepText.includes("trình duyệt") || stepText.includes("browser") || stepText.includes("khởi động")) {
      checkLaunch?.classList.add("checked");
    }
    if (stepText.includes("gemini") || stepText.includes("di chuyển") || stepText.includes("đăng nhập")) {
      checkLaunch?.classList.add("checked");
      checkNav?.classList.add("checked");
    }
    if (stepText.includes("video") || stepText.includes("tạo video") || stepText.includes("render")) {
      checkLaunch?.classList.add("checked");
      checkNav?.classList.add("checked");
      checkRender?.classList.add("checked");
    }
  } else if (state.phase === "awaiting-video") {
    showPhase("videoReview");
    const filename = state.videoPath.split(/[/\\]/).pop();
    document.getElementById("video-player").src = `/media/${filename}`;
    if (reviewActionsEl) reviewActionsEl.style.display = "flex";
    
    checkLaunch?.classList.add("checked");
    checkNav?.classList.add("checked");
    checkRender?.classList.add("checked");
  } else if (state.phase === "awaiting-metadata") {
    // Show both the video review and the metadata form for side-by-side editing
    showPhase("videoReview", "metadataReview");
    if (reviewActionsEl) reviewActionsEl.style.display = "none"; // Hide approve/reject actions
    
    if (state.videoPath) {
      const filename = state.videoPath.split(/[/\\]/).pop();
      document.getElementById("video-player").src = `/media/${filename}`;
    }
    
    document.getElementById("meta-title").value = state.metadata.title;
    document.getElementById("meta-description").value = state.metadata.description;
    document.getElementById("meta-tags").value = state.metadata.tags.join(", ");
    
    checkLaunch?.classList.add("checked");
    checkNav?.classList.add("checked");
    checkRender?.classList.add("checked");
  } else if (state.phase === "done") {
    showPhase("result");
    
    // Dynamically insert success icon wrapper
    document.getElementById("result-icon-container").innerHTML = `
      <div class="result-icon-glow success">
        <div class="result-icon-circle success">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="result-ping success"></div>
      </div>
    `;
    
    document.getElementById("result-title").textContent = "Quy trình hoàn tất";
    document.getElementById("result-header-text").textContent = "Hoàn thành quy trình Pipeline";
    
    document.getElementById("result-message").innerHTML =
      `<div class="success-alert">Đã đăng thành công lên YouTube!</div>
       <a href="${state.youtubeUrl}" class="btn-youtube-premium" target="_blank" rel="noopener">
         <span>Xem video trên YouTube</span>
         <span class="btn-icon-circle-youtube">
           <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
             <path d="M8 5v14l11-7z"/>
           </svg>
         </span>
       </a>`;
  } else if (state.phase === "error") {
    showPhase("result");
    
    // Dynamically insert error icon wrapper
    document.getElementById("result-icon-container").innerHTML = `
      <div class="result-icon-glow error">
        <div class="result-icon-circle error">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
      </div>
    `;
    
    document.getElementById("result-title").textContent = "Gặp sự cố vận hành";
    document.getElementById("result-header-text").textContent = "Lỗi quy trình Pipeline";
    
    document.getElementById("result-message").innerHTML = 
      `<div class="error-alert">Đã xảy ra lỗi: ${state.message || "Không xác định"}</div>`;
  } else {
    showPhase("idlePreview");
  }
}

new EventSource("/api/events").onmessage = (e) => renderState(JSON.parse(e.data));

// --- SETUP WIZARD ORCHESTRATION ---
const setupWizardContainer = document.getElementById("setup-wizard-container");
const mainDashboard = document.getElementById("main-dashboard");
const btnInitEnv = document.getElementById("btn-init-env");
const envCreateContainer = document.getElementById("env-create-container");
const envCreatedMsg = document.getElementById("env-created-msg");
const btnCheckLogin = document.getElementById("btn-check-login");
const checkLoginSpinIcon = btnCheckLogin.querySelector(".spin-icon-slow");

const wizardConfigForm = document.getElementById("wizard-config-form");
const wizardSaveStatus = document.getElementById("wizard-save-status");
const btnToggleAdvanced = document.getElementById("btn-toggle-advanced");
const advancedConfigFields = document.getElementById("advanced-config-fields");

const badgeChrome = document.getElementById("badge-chrome");
const chromeNotFound = document.getElementById("chrome-not-found");
const chromeFound = document.getElementById("chrome-found");

const badgeEnv = document.getElementById("badge-env");
const badgeLogin = document.getElementById("badge-login");
const badgeKeys = document.getElementById("badge-keys");

const progressFill = document.getElementById("wizard-progress-fill");
const progressStepCount = document.getElementById("wizard-progress-step-count");

let isSetupComplete = false;

// Expand/collapse steps when header is clicked
document.querySelectorAll(".wizard-step").forEach((stepEl) => {
  const header = stepEl.querySelector(".step-header");
  header.addEventListener("click", () => {
    const wasActive = stepEl.classList.contains("active");
    document.querySelectorAll(".wizard-step").forEach((el) => el.classList.remove("active"));
    if (!wasActive) {
      stepEl.classList.add("active");
    }
  });
});

async function checkSetupStatus() {
  try {
    const status = await fetch("/api/setup-status").then((r) => r.json());
    let completedSteps = 0;
    
    // Step 1: Chrome
    if (status.chromeInstalled) {
      badgeChrome.className = "step-badge badge-success";
      badgeChrome.textContent = "Đã có";
      chromeNotFound.hidden = true;
      chromeFound.hidden = false;
      document.getElementById("step-chrome").classList.add("completed");
      completedSteps++;
    } else {
      badgeChrome.className = "step-badge badge-error";
      badgeChrome.textContent = "Thiếu";
      chromeNotFound.hidden = false;
      chromeFound.hidden = true;
      document.getElementById("step-chrome").classList.remove("completed");
    }
    
    // Step 2: Env File
    if (status.envFileCreated) {
      badgeEnv.className = "step-badge badge-success";
      badgeEnv.textContent = "Đã có";
      envCreateContainer.hidden = true;
      envCreatedMsg.hidden = false;
      document.getElementById("step-env").classList.add("completed");
      completedSteps++;
    } else {
      badgeEnv.className = "step-badge badge-error";
      badgeEnv.textContent = "Chưa có";
      envCreateContainer.hidden = false;
      envCreatedMsg.hidden = true;
      document.getElementById("step-env").classList.remove("completed");
    }
    
    // Step 3: Gemini Login
    if (status.geminiProfileLoggedIn) {
      badgeLogin.className = "step-badge badge-success";
      badgeLogin.textContent = "Đã đăng nhập";
      document.getElementById("step-login").classList.add("completed");
      completedSteps++;
    } else {
      badgeLogin.className = "step-badge badge-error";
      badgeLogin.textContent = "Chưa đăng nhập";
      document.getElementById("step-login").classList.remove("completed");
    }
    
    // Step 4: Required Keys
    if (status.requiredKeysSet) {
      badgeKeys.className = "step-badge badge-success";
      badgeKeys.textContent = "Đã đủ";
      document.getElementById("step-keys").classList.add("completed");
      completedSteps++;
    } else {
      badgeKeys.className = "step-badge badge-error";
      badgeKeys.textContent = "Chưa đủ";
      document.getElementById("step-keys").classList.remove("completed");
    }
    
    // Update progress bar
    const percentage = (completedSteps / 4) * 100;
    progressFill.style.width = `${percentage}%`;
    progressStepCount.textContent = `${completedSteps}/4`;
    
    // Toggle layouts
    if (completedSteps === 4) {
      if (!isSetupComplete) {
        isSetupComplete = true;
        setupWizardContainer.hidden = true;
        mainDashboard.hidden = false;
        loadConfig();
        loadCars();
        loadYoutubeChannelInfo();
      }
    } else {
      isSetupComplete = false;
      setupWizardContainer.hidden = false;
      mainDashboard.hidden = true;
      
      // Auto-expand first incomplete step if nothing is active
      const steps = ["chrome", "env", "login", "keys"];
      const stepStates = [
        status.chromeInstalled,
        status.envFileCreated,
        status.geminiProfileLoggedIn,
        status.requiredKeysSet
      ];
      
      const anyActive = document.querySelector(".wizard-step.active");
      if (!anyActive) {
        for (let i = 0; i < steps.length; i++) {
          if (!stepStates[i]) {
            document.getElementById(`step-${steps[i]}`).classList.add("active");
            break;
          }
        }
      }
    }
    
    // Pre-fill inputs with placeholders
    if (status.envFileCreated && status.keysConfig) {
      const keys = status.keysConfig;
      
      updateInputPlaceholder("wiz-gemini-key", keys.GEMINI_API_KEY);
      updateInputPlaceholder("wiz-yt-id", keys.YOUTUBE_CLIENT_ID);
      updateInputPlaceholder("wiz-yt-secret", keys.YOUTUBE_CLIENT_SECRET);
      updateInputPlaceholder("wiz-yt-refresh", keys.YOUTUBE_REFRESH_TOKEN);
      
      if (keys.GEMINI_TEXT_MODEL?.isSet && !document.getElementById("wiz-gemini-model").value) {
        document.getElementById("wiz-gemini-model").placeholder = keys.GEMINI_TEXT_MODEL.masked;
      }
      if (keys.YOUTUBE_PRIVACY_STATUS?.isSet) {
        const val = keys.YOUTUBE_PRIVACY_STATUS.masked;
        if (val) document.getElementById("wiz-yt-privacy").value = val;
      }
      updateInputPlaceholder("wiz-tg-token", keys.TELEGRAM_BOT_TOKEN);
      if (keys.TELEGRAM_CHAT_ID?.isSet && !document.getElementById("wiz-tg-chat").value) {
        document.getElementById("wiz-tg-chat").placeholder = keys.TELEGRAM_CHAT_ID.masked;
      }
    }
  } catch (e) {
    console.error("Lỗi kiểm tra setup:", e);
  }
}

function updateInputPlaceholder(id, keyInfo) {
  const input = document.getElementById(id);
  if (keyInfo && keyInfo.isSet) {
    input.placeholder = `Để trống để giữ nguyên (${keyInfo.masked})`;
  } else {
    input.placeholder = "Nhập giá trị mới...";
  }
}

// Copy button handlers
document.querySelectorAll(".btn-copy").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = btn.getAttribute("data-copy");
    navigator.clipboard.writeText(text).then(() => {
      btn.classList.add("copied");
      const originalSvg = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = originalSvg;
      }, 2000);
    });
  });
});

// Auto create .env file
btnInitEnv.addEventListener("click", async () => {
  const res = await fetch("/api/setup/init-env", { method: "POST" });
  if (res.ok) {
    await checkSetupStatus();
  } else {
    const err = await res.json();
    alert("Không thể tạo file .env: " + err.error);
  }
});

// Manual login status check
btnCheckLogin.addEventListener("click", async () => {
  checkLoginSpinIcon.style.display = "inline-block";
  btnCheckLogin.querySelector("span").textContent = "Đang kết nối...";
  btnCheckLogin.disabled = true;
  
  await checkSetupStatus();
  
  setTimeout(() => {
    checkLoginSpinIcon.style.display = "none";
    btnCheckLogin.querySelector("span").textContent = "Kiểm tra lại kết nối";
    btnCheckLogin.disabled = false;
  }, 1000);
});

// Toggle advanced fields
btnToggleAdvanced.addEventListener("click", () => {
  const isHidden = advancedConfigFields.style.display === "none";
  if (isHidden) {
    advancedConfigFields.style.display = "flex";
    btnToggleAdvanced.textContent = "Ẩn cấu hình nâng cao ▴";
  } else {
    advancedConfigFields.style.display = "none";
    btnToggleAdvanced.textContent = "Cấu hình nâng cao (Tùy chọn) ▾";
  }
});

// Save config from Setup Wizard
wizardConfigForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  
  const fields = {
    GEMINI_API_KEY: "wiz-gemini-key",
    YOUTUBE_CLIENT_ID: "wiz-yt-id",
    YOUTUBE_CLIENT_SECRET: "wiz-yt-secret",
    YOUTUBE_REFRESH_TOKEN: "wiz-yt-refresh",
    GEMINI_TEXT_MODEL: "wiz-gemini-model",
    YOUTUBE_PRIVACY_STATUS: "wiz-yt-privacy",
    TELEGRAM_BOT_TOKEN: "wiz-tg-token",
    TELEGRAM_CHAT_ID: "wiz-tg-chat"
  };
  
  for (const [key, id] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && el.value) body[key] = el.value;
  }
  
  wizardSaveStatus.className = "status-msg status-loading";
  wizardSaveStatus.textContent = "Đang lưu cấu hình...";
  
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  
  if (res.ok) {
    wizardSaveStatus.className = "status-msg status-success";
    wizardSaveStatus.textContent = "Đã lưu cấu hình thành công!";
    
    // Clear password inputs
    for (const [key, id] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el && el.type === "password") el.value = "";
    }
    
    await checkSetupStatus();
  } else {
    const err = await res.json();
    wizardSaveStatus.className = "status-msg status-error";
    wizardSaveStatus.textContent = `Lỗi: ${err.error}`;
  }
});

// Run initial check and set periodic status polling
checkSetupStatus();
setInterval(() => {
  if (!isSetupComplete) {
    checkSetupStatus();
  }
}, 3000);

// --- SETTINGS DRAWER EVENT HANDLERS ---
const settingsDrawer = document.getElementById("settings-drawer");
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const drawerOverlay = document.getElementById("drawer-overlay");

function openSettings() {
  settingsDrawer.hidden = false;
  requestAnimationFrame(() => {
    settingsDrawer.classList.add("active");
  });
}

function closeSettings() {
  settingsDrawer.classList.remove("active");
  setTimeout(() => {
    if (!settingsDrawer.classList.contains("active")) {
      settingsDrawer.hidden = true;
    }
  }, 400);
}

btnOpenSettings?.addEventListener("click", openSettings);
btnCloseSettings?.addEventListener("click", closeSettings);
drawerOverlay?.addEventListener("click", closeSettings);

// Link sidebar settings button to openSettings
document.getElementById("sidebar-btn-settings")?.addEventListener("click", (e) => {
  e.preventDefault();
  openSettings();
});

// --- SYSTEM PERFORMANCE STATS ANIMATION ---
const statFps = document.getElementById("stat-fps");
const statGpu = document.getElementById("stat-gpu");
const statRam = document.getElementById("stat-ram");
const statFpsBar = document.getElementById("stat-fps-bar");
const statGpuBar = document.getElementById("stat-gpu-bar");
const statRamBar = document.getElementById("stat-ram-bar");

function updateStats() {
  const isPipelineRunning = sections.idlePreview && sections.idlePreview.hidden === true && sections.progress.hidden === false;
  
  let fps, gpu, ram;
  if (isPipelineRunning) {
    fps = Math.floor(28 + Math.random() * 4); // 28-32 FPS
    gpu = Math.floor(70 + Math.random() * 15); // 70-85% GPU active
    ram = (11.5 + Math.random() * 0.8).toFixed(1); // 11.5 - 12.3 GB RAM active
  } else {
    fps = 0;
    gpu = Math.floor(2 + Math.random() * 5); // 2-7% GPU idle
    ram = (8.1 + Math.random() * 0.3).toFixed(1); // 8.1 - 8.4 GB RAM idle
  }
  
  if (statFps) {
    statFps.textContent = fps;
    if (statFpsBar) statFpsBar.style.width = `${(fps / 60) * 100}%`;
  }
  if (statGpu) {
    statGpu.textContent = `${gpu}%`;
    if (statGpuBar) statGpuBar.style.width = `${gpu}%`;
  }
  if (statRam) {
    statRam.textContent = `${ram} GB`;
    if (statRamBar) statRamBar.style.width = `${(parseFloat(ram) / 16) * 100}%`; // Out of 16GB
  }
}
setInterval(updateStats, 1500);
updateStats();

async function loadYoutubeChannelInfo() {
  const cardBody = document.getElementById("yt-channel-card-body");
  if (!cardBody) return;
  
  // Set skeleton loading state
  cardBody.innerHTML = `
    <div class="yt-channel-skeleton">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-meta">
        <div class="skeleton-line title"></div>
        <div class="skeleton-line handle"></div>
      </div>
    </div>
    <div class="skeleton-details mt-3">
      <div class="skeleton-detail-item"></div>
      <div class="skeleton-detail-item"></div>
    </div>
  `;
  
  try {
    const res = await fetch("/api/youtube-channel");
    if (!res.ok) {
      throw new Error("HTTP error " + res.status);
    }
    const info = await res.json();
    if (!info) {
      // Not configured or returned null
      cardBody.innerHTML = `
        <div class="yt-channel-error">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-warning">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <div class="yt-channel-error-text">Chưa kết nối YouTube</div>
          <p class="small-text font-muted mt-1" style="text-align: center;">Vui lòng cấu hình YOUTUBE_REFRESH_TOKEN trong Cấu hình nhanh.</p>
        </div>
      `;
      return;
    }
    
    if (info.error === "insufficient_scope") {
      cardBody.innerHTML = `
        <div class="yt-channel-error">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-danger">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div class="yt-channel-error-text" style="color: var(--color-danger);">Quyền hạn không đủ</div>
          <p class="small-text font-muted mt-1" style="text-align: center; padding: 0 0.5rem; line-height: 1.4;">
            Token hiện tại thiếu quyền đọc thông tin kênh. Vui lòng cấp lại token với các scope:<br/>
            <code style="display:inline-block; margin-top:0.25rem; font-size:10px; color:#ff4a6b; background:rgba(255,74,107,0.1); padding:1px 4px; border-radius:3px; word-break:break-all;">youtube.upload</code><br/>
            <code style="display:inline-block; margin-top:0.25rem; font-size:10px; color:#ff4a6b; background:rgba(255,74,107,0.1); padding:1px 4px; border-radius:3px; word-break:break-all;">youtube.readonly</code>
          </p>
        </div>
      `;
      return;
    }
    
    // Configured and active!
    const formattedSubs = Number(info.subscriberCount).toLocaleString('vi-VN');
    const formattedVideos = Number(info.videoCount).toLocaleString('vi-VN');
    
    cardBody.innerHTML = `
      <div class="yt-channel-profile">
        <img class="yt-channel-avatar" src="${info.thumbnail}" alt="${info.title}" />
        <div class="yt-channel-meta">
          <span class="yt-channel-title" title="${info.title}">${info.title}</span>
          <span class="yt-channel-handle" title="${info.customUrl}">${info.customUrl || ''}</span>
        </div>
      </div>
      <div class="video-info-list mt-3">
        <div class="video-info-item">
          <span class="label">Quyền riêng tư:</span>
          <span class="value badge-privacy ${info.privacyStatus}">${info.privacyStatus}</span>
        </div>
        <div class="video-info-item">
          <span class="label">Người đăng ký:</span>
          <span class="value font-medium text-white">${formattedSubs}</span>
        </div>
        <div class="video-info-item">
          <span class="label">Tổng số video:</span>
          <span class="value font-medium text-white">${formattedVideos}</span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("Lỗi tải thông tin kênh YouTube:", err);
    cardBody.innerHTML = `
      <div class="yt-channel-error">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-warning">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <div class="yt-channel-error-text">Không thể kết nối API</div>
      </div>
    `;
  }
}
