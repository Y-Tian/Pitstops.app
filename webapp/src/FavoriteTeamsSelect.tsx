import React, { useMemo } from 'react';
import Select from 'react-select';

interface TeamOption {
  value: string;
  label: string;
}

interface FavoriteTeamsSelectProps {
  teams: string[];
  selectedTeamNames: string[];
  onSelectionChange: (teamNames: string[]) => void;
}

export const FavoriteTeamsSelect: React.FC<FavoriteTeamsSelectProps> = ({
  teams,
  selectedTeamNames,
  onSelectionChange,
}) => {
  const teamOptions = useMemo(() => {
    return teams
      .map((team) => ({
        value: team,
        label: team,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [teams]);

  const selectedOptions = useMemo(() => {
    return teamOptions.filter((opt) => selectedTeamNames.includes(opt.value));
  }, [teamOptions, selectedTeamNames]);

  const handleChange = (options: readonly TeamOption[] | null) => {
    onSelectionChange(options ? Array.from(options).map((opt) => opt.value) : []);
  };

  return (
    <Select
      isMulti
      options={teamOptions}
      value={selectedOptions}
      onChange={handleChange as any}
      placeholder="Keep track of your favourite teams..."
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
