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

function hidePhaseSections() {
  for (const el of Object.values(sections)) {
    if (el) el.hidden = true;
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
  } else {
    const err = await res.json();
    configStatus.className = "status-msg status-error";
    configStatus.textContent = `Lỗi: ${err.error}`;
  }
});

async function loadCars() {
  const { pool, queue } = await fetch("/api/cars").then((r) => r.json());
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
  carSelect.innerHTML = '<option value="">-- dùng queue mặc định --</option>';
  for (const car of pool) {
    const option = document.createElement("option");
    option.value = car;
    option.textContent = car;
    carSelect.appendChild(option);
  }
}

generateBtn.addEventListener("click", async () => {
  const car = carSelect.value || undefined;
  generateStatus.className = "status-msg";
  generateStatus.textContent = "Đang gửi yêu cầu khởi tạo...";
  
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ car }),
  });
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

document.getElementById("reset-btn").addEventListener("click", () => {
  hidePhaseSections();
  loadCars();
});

function renderState(state) {
  hidePhaseSections();

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

  if (state.phase === "running") {
    sections.progress.hidden = false;
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
    sections.videoReview.hidden = false;
    const filename = state.videoPath.split("/").pop();
    document.getElementById("video-player").src = `/media/${filename}`;
    
    checkLaunch?.classList.add("checked");
    checkNav?.classList.add("checked");
    checkRender?.classList.add("checked");
  } else if (state.phase === "awaiting-metadata") {
    sections.metadataReview.hidden = false;
    document.getElementById("meta-title").value = state.metadata.title;
    document.getElementById("meta-description").value = state.metadata.description;
    document.getElementById("meta-tags").value = state.metadata.tags.join(", ");
    
    checkLaunch?.classList.add("checked");
    checkNav?.classList.add("checked");
    checkRender?.classList.add("checked");
  } else if (state.phase === "done") {
    sections.result.hidden = false;
    document.getElementById("result-message").innerHTML =
      `<p class="success-alert">Đã đăng thành công lên YouTube!</p>
       <a href="${state.youtubeUrl}" class="youtube-link-btn" target="_blank" rel="noopener">
         <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
           <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.107C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.388.511a3.003 3.003 0 0 0-2.11 2.107C0 8.053 0 12 0 12s0 3.948.502 5.837a3.003 3.003 0 0 0 2.11 2.107C4.495 20.455 12 20.455 12 20.455s7.505 0 9.388-.511a3.003 3.003 0 0 0 2.11-2.107C24 15.948 24 12 24 12s0-3.948-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
         </svg>
         <span>Xem video trên YouTube</span>
       </a>`;
  } else if (state.phase === "error") {
    sections.result.hidden = false;
    document.getElementById("result-message").innerHTML = 
      `<p class="error-alert">Đã xảy ra lỗi: ${state.message}</p>`;
  } else {
    sections.idlePreview.hidden = false;
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
