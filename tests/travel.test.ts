import { describe, expect, it } from "vitest";
import {
  addDays,
  ctripHotelDetailUrl,
  ctripHotelListUrl,
  pickCtripHotelCity,
  extractRoutePair,
  extractTravelCity,
  flightFallbackUrl,
  flightSearchUrl,
  isFlightResultUrl,
  parseLooseCheckin,
  parseTravelQuery,
  shouldFallbackFlight,
  travelListState,
  travelResultUrl,
} from "../src/main/agent/travel.js";
import { expandTripPlan, parseTripPlan } from "../src/main/agent/trip-plan.js";

describe("parseTravelQuery", () => {
  const now = new Date(2026, 8, 1);

  it("parses 携程 + 城市 + 9月15日", () => {
    const q = parseTravelQuery(
      "帮我查查携程 找一些 9月15日 伊斯坦布尔的酒店",
      now,
    );
    expect(q).toMatchObject({
      kind: "hotel",
      city: "伊斯坦布尔",
      checkin: "2026-09-15",
      checkout: "2026-09-16",
      site: "ctrip",
    });
  });

  it("does not treat 打开携程机票 as hotel search", () => {
    expect(parseTravelQuery("打开携程，我想看看机票", now)).toBeNull();
  });

  it("途牛酒店不会被携程抢走", () => {
    const q = parseTravelQuery("打开途牛，查9月15日伊斯坦布尔的酒店", now);
    expect(q).toMatchObject({ kind: "hotel", site: "tuniu", city: "伊斯坦布尔" });
  });

  it("Booking 酒店走 booking", () => {
    const q = parseTravelQuery(
      "打开 https://www.booking.com 查9月15日伊斯坦布尔的酒店",
      now,
    );
    expect(q).toMatchObject({ kind: "hotel", site: "booking", city: "伊斯坦布尔" });
  });

  it("北京飞伊斯坦布尔机票带日期", () => {
    const q = parseTravelQuery("在携程查9月15日北京到伊斯坦布尔的机票", now);
    expect(q).toMatchObject({
      kind: "flight",
      site: "ctrip",
      from: "北京",
      to: "伊斯坦布尔",
      date: "2026-09-15",
    });
  });

  it("从第比利斯回到北京是机票起终点，不是「第比利斯回」", () => {
    const q = parseTravelQuery("在携程查9月27日从第比利斯回到北京的机票", now);
    expect(q).toMatchObject({
      kind: "flight",
      from: "第比利斯",
      to: "北京",
      date: "2026-09-27",
    });
  });

  it("高德路线解析起终点", () => {
    const q = parseTravelQuery("打开高德地图，查从北京南站到天安门怎么走", now);
    expect(q).toMatchObject({
      kind: "maps",
      site: "amap",
      from: "北京南站",
      to: "天安门",
    });
  });

  it("携程火车票", () => {
    const q = parseTravelQuery("打开携程，查9月15日北京到上海的火车票", now);
    expect(q).toMatchObject({
      kind: "train",
      site: "ctrip",
      from: "北京",
      to: "上海",
      date: "2026-09-15",
    });
  });

  it("从第比利斯回到北京的机票", () => {
    const q = parseTravelQuery("在携程查9月27日从第比利斯回到北京的机票", now);
    expect(q).toMatchObject({
      kind: "flight",
      from: "第比利斯",
      to: "北京",
      date: "2026-09-27",
    });
  });

  it("多段规划不当成单次高德导航", () => {
    expect(
      parseTravelQuery(
        "帮我查询地图，查询航班，查询酒店，帮我规划一个9月18号从北京出发，然后9月27号回到北京，要去土耳其和格鲁吉亚两个城市",
        now,
      ),
    ).toBeNull();
  });
});

describe("date helpers", () => {
  it("rolls past dates to next year", () => {
    expect(parseLooseCheckin("1月5日", new Date(2026, 8, 1))).toBe("2027-01-05");
  });

  it("adds one night", () => {
    expect(addDays("2026-09-15", 1)).toBe("2026-09-16");
  });
});

describe("extractTravelCity", () => {
  it("reads X的酒店", () => {
    expect(extractTravelCity("找一些东京的酒店")).toBe("东京");
  });
});

describe("result urls", () => {
  it("strips 做一个 so 北京到曼谷 is a real pair", () => {
    expect(
      extractRoutePair("帮我做一个北京到曼谷的旅游攻略 9月16日出发"),
    ).toEqual({ from: "北京", to: "曼谷" });
  });

  it("flight ctrip uses bjs-bkk and never opens /channel", () => {
    const url = flightSearchUrl({
      kind: "flight",
      site: "ctrip",
      from: "做一个北京",
      to: "曼谷",
      date: "2026-09-16",
    });
    expect(url).toContain("oneway-bjs-bkk");
    expect(url).toContain("2026-09-16");
    expect(url).not.toContain("/channel");
  });

  it("flight ctrip uses bjs-ist not sha", () => {
    const url = flightSearchUrl({
      kind: "flight",
      site: "ctrip",
      from: "北京",
      to: "伊斯坦布尔",
      date: "2026-09-15",
    });
    expect(url).toContain("oneway-bjs-ist");
    expect(url).toContain("2026-09-15");
    expect(url).not.toContain("bjs-sha");
  });

  it("maps baidu uses dir pair", () => {
    const url = travelResultUrl({
      kind: "maps",
      site: "baidumap",
      from: "北京南站",
      to: "天安门",
    });
    expect(url).toContain("map.baidu.com/dir/");
  });
});

describe("travelListState", () => {
  it("chrome-only Ctrip footer is pending", () => {
    const chrome = "携程旅行网\n我的订单\n关于携程\nICP证：沪B2-20050130";
    expect(travelListState("flight", chrome)).toBe("pending");
    expect(shouldFallbackFlight(chrome, "ctrip")).toBe(true);
  });

  it("nearby-city empty state is not a real IST flight list", () => {
    const nearby = "未找到符合条件的航班 为您推荐 北京 → 伊兹密尔：¥3179";
    expect(travelListState("flight", nearby)).toBe("empty");
    expect(shouldFallbackFlight(nearby, "ctrip")).toBe(true);
    expect(shouldFallbackFlight(nearby, "gflights")).toBe(false);
  });

  it("price plus time is ready", () => {
    expect(
      travelListState("flight", "土耳其航空 08:20-14:10 直飞 ¥4820"),
    ).toBe("ready");
    expect(
      shouldFallbackFlight("土耳其航空 08:20-14:10 直飞 ¥4820", "ctrip"),
    ).toBe(false);
  });

  it("Ctrip channel landing is not a flight result", () => {
    const promo = "航司专区 北京到上海 ¥350 中国国际航空";
    expect(
      isFlightResultUrl("https://flights.ctrip.com/online/channel"),
    ).toBe(false);
    expect(
      isFlightResultUrl(
        "https://flights.ctrip.com/online/list/oneway-bjs-bkk?depdate=2026-09-16",
      ),
    ).toBe(true);
    expect(
      shouldFallbackFlight(promo, "ctrip", "https://flights.ctrip.com/online/channel"),
    ).toBe(true);
  });

  it("Trip.com fallback uses IST date", () => {
    expect(
      flightFallbackUrl({
        kind: "flight",
        site: "ctrip",
        from: "北京",
        to: "伊斯坦布尔",
        date: "2026-09-18",
      }),
    ).toContain("tickets-pek-ist");
  });
});

describe("ctripHotelDetailUrl", () => {
  it("builds a clickable hotel page", () => {
    expect(ctripHotelDetailUrl("345067", "2026-09-18", "2026-09-21")).toBe(
      "https://hotels.ctrip.com/hotels/345067.html?checkIn=2026-09-18&checkOut=2026-09-21",
    );
  });
});

describe("ctripHotelListUrl", () => {
  it("builds list url with city and dates", () => {
    expect(ctripHotelListUrl(532, "2026-09-15", "2026-09-16")).toContain(
      "city=532",
    );
    expect(ctripHotelListUrl(532, "2026-09-15", "2026-09-16")).toContain(
      "checkin=2026-09-15",
    );
  });
});

describe("pickCtripHotelCity", () => {
  it("prefers district cityId over empty hotellist", () => {
    const hit = pickCtripHotelCity(
      [
        { type: "district", word: "三亚", cityId: 43, id: 61 },
        { type: "hotellist", word: "三亚的全部酒店", cityId: 0, id: 0 },
        { type: "hotel", word: "三亚亚龙湾美高梅度假酒店", cityId: 43, id: 345078 },
      ],
      "三亚",
    );
    expect(hit).toEqual({ cityId: 43, label: "三亚" });
  });
});
