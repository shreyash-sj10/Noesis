type Kpi = {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
};

type Props = {
  items: Kpi[];
  isLoading?: boolean;
};

export default function HomeKpiStrip({ items, isLoading = false }: Props) {
  return (
    <section className="home-kpi-strip" aria-label="Account at a glance">
      {items.map((item) => (
        <div key={item.label} className="home-kpi-strip__cell">
          <p className="home-kpi-strip__label">{item.label}</p>
          {isLoading ? (
            <div className="home-kpi-strip__skeleton" aria-hidden />
          ) : (
            <>
              <p className={`home-kpi-strip__value ${item.valueClassName ?? ""}`}>{item.value}</p>
              {item.sub ? <p className="home-kpi-strip__sub">{item.sub}</p> : null}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
