import L from 'leaflet';

/** 高德瓦片（GCJ-02，与后端高德地理编码坐标系一致，无需 Web端 JS Key） */
export function createGaodeTileLayer() {
  return L.tileLayer(
    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      attribution: '&copy; 高德地图',
    },
  );
}
