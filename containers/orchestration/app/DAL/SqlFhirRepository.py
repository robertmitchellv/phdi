from sqlalchemy.orm import Session

from app.DAL.FhirRepository import FhirRepository


class SqlAlchemyFhirRepository(FhirRepository):
    def __init__(self, session: Session):
        self.session = session

    def persist(self, entity):
        self.session.add(entity)
        self.session.commit()
        return entity