'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function TripFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <form
      key={searchParams.toString()}
      className="trip-filters"
      aria-label="Bộ lọc chuyến xe"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const parameters = new URLSearchParams(searchParams.toString());
        for (const key of [
          'timeRange',
          'maxPrice',
          'operator',
          'vehicleType',
          'minSeats',
          'sort',
        ]) {
          const value = String(formData.get(key) ?? '');
          if (value) parameters.set(key, value);
          else parameters.delete(key);
        }
        router.replace(`/trips?${parameters.toString()}`);
      }}
    >
      <div>
        <label htmlFor="timeRange">Giờ khởi hành</label>
        <select id="timeRange" name="timeRange" defaultValue={searchParams.get('timeRange') ?? ''}>
          <option value="">Cả ngày</option>
          <option value="morning">Sáng · trước 12:00</option>
          <option value="afternoon">Chiều · 12:00–17:59</option>
          <option value="evening">Tối · từ 18:00</option>
        </select>
      </div>
      <div>
        <label htmlFor="maxPrice">Giá tối đa</label>
        <select id="maxPrice" name="maxPrice" defaultValue={searchParams.get('maxPrice') ?? ''}>
          <option value="">Mọi mức giá</option>
          <option value="250000">250.000đ</option>
          <option value="300000">300.000đ</option>
          <option value="400000">400.000đ</option>
        </select>
      </div>
      <div>
        <label htmlFor="operator">Nhà xe</label>
        <select id="operator" name="operator" defaultValue={searchParams.get('operator') ?? ''}>
          <option value="">Tất cả nhà xe</option>
          <option value="PT-DEMO">Phương Trang Demo</option>
          <option value="TB-DEMO">Thành Bưởi Demo</option>
          <option value="KH-DEMO">Kumho Demo</option>
        </select>
      </div>
      <div>
        <label htmlFor="vehicleType">Loại xe</label>
        <select
          id="vehicleType"
          name="vehicleType"
          defaultValue={searchParams.get('vehicleType') ?? ''}
        >
          <option value="">Tất cả loại xe</option>
          <option value="COACH-29">Ghế ngồi 29 chỗ</option>
          <option value="SLEEPER-34">Giường nằm 34 chỗ</option>
          <option value="LIMO-22">Limousine 22 chỗ</option>
        </select>
      </div>
      <div>
        <label htmlFor="minSeats">Số chỗ cần</label>
        <select id="minSeats" name="minSeats" defaultValue={searchParams.get('minSeats') ?? ''}>
          <option value="">Không giới hạn</option>
          <option value="1">Ít nhất 1 chỗ</option>
          <option value="30">Ít nhất 30 chỗ</option>
        </select>
      </div>
      <div>
        <label htmlFor="sort">Sắp xếp</label>
        <select id="sort" name="sort" defaultValue={searchParams.get('sort') ?? ''}>
          <option value="">Giờ đi sớm nhất</option>
          <option value="PRICE_LOWEST">Giá thấp nhất</option>
          <option value="DURATION_SHORTEST">Thời gian ngắn nhất</option>
        </select>
      </div>
      <button type="submit">Áp dụng</button>
      <button
        type="button"
        className="filter-reset"
        onClick={() => {
          const parameters = new URLSearchParams(searchParams.toString());
          for (const key of [
            'timeRange',
            'maxPrice',
            'operator',
            'vehicleType',
            'minSeats',
            'sort',
          ]) {
            parameters.delete(key);
          }
          router.replace(`/trips?${parameters.toString()}`);
        }}
      >
        Xóa lọc
      </button>
    </form>
  );
}
