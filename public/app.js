const configForm = document.getElementById("config-form");
const configStatus = document.getElementById("config-status");
const queueList = document.getElementById("queue-list");
const carSelect = document.getElementById("car-select");
const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");

const sections = {
  progress: document.getElementById("progress"),
  videoReview: document.getElementById("video-review"),
  metadataReview: document.getElementById("metadata-review"),
  result: document.getElementById("result"),
};

function hidePhaseSections() {
  for (const el of Object.values(sections)) el.hidden = true;
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

  if (state.phase === "running") {
    sections.progress.hidden = false;
    document.getElementById("progress-car").textContent = state.car || "Chưa xác định";
    document.getElementById("progress-step").textContent = state.step;
  } else if (state.phase === "awaiting-video") {
    sections.videoReview.hidden = false;
    const filename = state.videoPath.split("/").pop();
    document.getElementById("video-player").src = `/media/${filename}`;
  } else if (state.phase === "awaiting-metadata") {
    sections.metadataReview.hidden = false;
    document.getElementById("meta-title").value = state.metadata.title;
    document.getElementById("meta-description").value = state.metadata.description;
    document.getElementById("meta-tags").value = state.metadata.tags.join(", ");
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
  }
}

new EventSource("/api/events").onmessage = (e) => renderState(JSON.parse(e.data));

loadConfig();
loadCars();
