// Hen gio trong Web Worker: khong bi Chrome "ha toc" khi tab Dashboard nam an phia sau
// (setTimeout tren tab an co the bi gian cach toi 1 phut).
self.onmessage = (e) => {
  const { id, ms } = e.data;
  setTimeout(() => self.postMessage(id), ms);
};
