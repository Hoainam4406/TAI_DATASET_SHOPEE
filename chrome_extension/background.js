// Bam icon extension -> mo (hoac chuyen toi) trang Dashboard.
// Moi viec cao/xu ly chay trong Dashboard, service worker chi lam viec nay.
const DASHBOARD = chrome.runtime.getURL("dashboard.html");

chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: DASHBOARD });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD });
  }
});
