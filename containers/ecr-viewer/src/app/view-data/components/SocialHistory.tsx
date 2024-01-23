import { DisplayData } from "@/app/utils";
import {
  AccordianSection,
  AccordianH3,
  AccordianDiv,
} from "../component-utils";

interface SocialHistoryProps {
  socialData: DisplayData[];
}

const SocialHistory = ({ socialData }: SocialHistoryProps) => {
  const renderDemographicsData = (item: any, index: number) => {
    return (
      <div key={index}>
        <div className="grid-row">
          <div className="data-title">
            <h4>{item.title}</h4>
          </div>
          <div className="grid-col-auto maxw7 text-pre-line">{item.value}</div>
        </div>
        <div className={"section__line_gray"} />
      </div>
    );
  };

  return (
    <AccordianSection>
      <AccordianH3>Social History</AccordianH3>
      <AccordianDiv>
        {socialData.map((item, index) => renderDemographicsData(item, index))}
      </AccordianDiv>
    </AccordianSection>
  );
};

export default SocialHistory;
