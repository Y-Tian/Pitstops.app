import React, { useMemo } from 'react';
import Select from 'react-select';
import type { LeaderboardRow } from './types';

interface DriverOption {
  value: number;
  label: string;
  driver: LeaderboardRow;
}

interface FavoriteDriversSelectProps {
  drivers: LeaderboardRow[];
  selectedDriverIds: number[];
  onSelectionChange: (driverIds: number[]) => void;
}

/** Strip *, (i), # decorators from driver name. Returns clean name + flags. */
function parseDriverName(raw: string): {
  clean: string;
  ineligible: boolean;
  rookie: boolean;
} {
  const s          = raw ?? '';
  const ineligible = s.includes('(i)') || s.includes('*');
  const rookie     = s.includes('#');
  const clean      = s
    .replace(/\*/g, '')
    .replace(/\(i\)/gi, '')
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { clean, ineligible, rookie };
}

export const FavoriteDriversSelect: React.FC<FavoriteDriversSelectProps> = ({
  drivers,
  selectedDriverIds,
  onSelectionChange,
}) => {
  const driverOptions = useMemo(() => {
    return drivers
      .map((driver) => {
        const { clean } = parseDriverName(driver.full_name);
        return {
          value: driver.driver_id,
          label: `${clean} #${driver.vehicle_number}`,
          driver,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [drivers]);

  const selectedOptions = useMemo(() => {
    return driverOptions.filter((opt) => selectedDriverIds.includes(opt.value));
  }, [driverOptions, selectedDriverIds]);

  const handleChange = (options: readonly DriverOption[] | null) => {
    onSelectionChange(options ? Array.from(options).map((opt) => opt.value) : []);
  };

  return (
    <Select
      isMulti
      options={driverOptions}
      value={selectedOptions}
      onChange={handleChange as any}
      placeholder="Keep track of your favorite drivers..."
      isClearable={selectedOptions.length > 0}
      isSearchable
      classNamePrefix="driver-select"
      styles={{
        control: (base) => ({
          ...base,
          background: '#0c0c18',
          borderColor: '#1a1a2e',
          color: '#e2e8f0',
          minHeight: '40px',
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 13,
          cursor: 'pointer',
          '&:hover': {
            borderColor: '#3c8bfa',
          },
        }),
        input: (base) => ({
          ...base,
          color: '#e2e8f0',
          fontFamily: 'Barlow Condensed, sans-serif',
        }),
        placeholder: (base) => ({
          ...base,
          color: '#64748b',
        }),
        multiValue: (base) => ({
          ...base,
          background: '#1a1a2e',
          color: '#e2e8f0',
        }),
        multiValueLabel: (base) => ({
          ...base,
          color: '#e2e8f0',
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 12,
        }),
        multiValueRemove: (base) => ({
          ...base,
          color: '#64748b',
          cursor: 'pointer',
          '&:hover': {
            background: '#ef4444',
            color: '#fff',
          },
        }),
        menu: (base) => ({
          ...base,
          background: '#07070f',
          borderColor: '#1a1a2e',
          zIndex: 1000,
        }),
        menuList: (base) => ({
          ...base,
          background: '#07070f',
          scrollBehavior: 'smooth',
        }),
        option: (base, state) => ({
          ...base,
          background: state.isSelected
            ? '#3c8bfa'
            : state.isFocused
              ? '#1a1a2e'
              : '#07070f',
          color: state.isSelected ? '#fff' : '#e2e8f0',
          cursor: 'pointer',
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 13,
          padding: '10px 12px',
          '&:active': {
            background: '#3c8bfa',
          },
        }),
        noOptionsMessage: (base) => ({
          ...base,
          color: '#64748b',
          fontFamily: 'Barlow Condensed, sans-serif',
        }),
        dropdownIndicator: (base) => ({
          ...base,
          color: '#3c8bfa',
          '&:hover': {
            color: '#276cdb',
          },
        }),
        clearIndicator: (base) => ({
          ...base,
          color: '#64748b',
          cursor: 'pointer',
          '&:hover': {
            color: '#ef4444',
          },
        }),
      }}
    />
  );
};
