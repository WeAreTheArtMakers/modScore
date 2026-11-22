/** One update prompt per waiting worker; listeners are owned by this controller. */
export function watchUpdates(
  reg: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
  beforeApply: () => Promise<void>,
  reload: () => void = () => location.reload(),
) {
  let requested = false,
    disposed = false,
    installer: ServiceWorker | null = null,
    banner: HTMLElement | undefined;
  const remove = () => {
    banner?.remove();
    banner = undefined;
  };
  const offer = () => {
    if (disposed) return;
    if (!reg.waiting || !container.controller) {
      remove();
      return;
    }
    if (banner?.isConnected) return;
    banner = document.createElement("div");
    banner.className = "update-banner";
    banner.role = "status";
    const message = document.createElement("span");
    message.textContent =
      document.documentElement.lang === "tr"
        ? "Yeni sürüm hazır. Kayıtlarınız korunur."
        : "An update is ready. Your scores will be preserved.";
    const apply = document.createElement("button");
    apply.textContent =
      document.documentElement.lang === "tr" ? "Güncelle" : "Update app";
    const later = document.createElement("button");
    later.textContent =
      document.documentElement.lang === "tr" ? "Daha sonra" : "Later";
    later.onclick = remove;
    apply.onclick = async () => {
      apply.disabled = true;
      try {
        await beforeApply();
        if (!reg.waiting) {
          remove();
          return;
        }
        requested = true;
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch (error) {
        requested = false;
        message.textContent = (error as Error).message;
        apply.disabled = false;
      }
    };
    banner.append(message, apply, later);
    document.body.append(banner);
  };
  const state = () => {
    offer();
    if (installer && ["installed", "redundant"].includes(installer.state)) {
      installer.removeEventListener("statechange", state);
      installer = null;
    }
  };
  const found = () => {
    installer?.removeEventListener("statechange", state);
    installer = reg.installing;
    installer?.addEventListener("statechange", state);
  };
  const changed = () => {
    remove();
    if (requested) reload();
  };
  reg.addEventListener("updatefound", found);
  container.addEventListener("controllerchange", changed);
  found();
  offer();
  return () => {
    disposed = true;
    remove();
    installer?.removeEventListener("statechange", state);
    reg.removeEventListener("updatefound", found);
    container.removeEventListener("controllerchange", changed);
  };
}
